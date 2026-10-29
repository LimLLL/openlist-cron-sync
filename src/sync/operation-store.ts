// 原子保存逻辑结果与尝试历史；重试保持依赖不变，事务内不执行网络请求。
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, max, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  operations,
  operationDependencies,
  operationAttempts,
} from '../database/operation-schema.js';
import type { ExecutionRecord } from '../database/operation-schema.js';
import {
  currentAttempt,
  executionColumns,
  executionRecord,
  insertOperation,
} from '../database/operation-records.js';
import { runs } from '../database/run-schema.js';
import type { RunRecord } from '../database/run-schema.js';
import type { MultipartSnapshot } from '../openlist/multipart.service.js';
import { backoffMs } from '../common/backoff.js';

/** 不可改写的操作终态。 */
export type OperationEnd =
  'succeeded' | 'failed' | 'skipped' | 'unknown' | 'cancelled';
/** 与终态一起写入的结果字段。 */
export interface Outcome {
  /** 规范终态。 */
  status: OperationEnd;
  /** 受控原因码，成功可为空。 */
  code?: string;
  /** 脱敏摘要，不接受上游原始消息。 */
  message?: string;
}
/** 一个Run的操作存取和事务边界。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class OperationStore {
  /** 本Run每个Target已预留的cleanup根数；仅为同步事务的有界派生计数。 */
  private readonly cleanupCounts = new Map<string, number>();
  /** 保存同一写连接及固定Run。
   * @param db 数据库。
   * @param run 固定Run。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    readonly db: BetterSQLite3Database,
    readonly run: RunRecord,
  ) {}
  /** 取得指定尝试的持久化状态与不可变计划。
   * @param id Attempt ID。
   * @returns 完整执行上下文。
   * @throws Error 记录缺失。
   */
  get(id: string): ExecutionRecord {
    const row = executionRecord(this.db, id);
    if (!row || row.runId !== this.run.id) throw new Error('Attempt missing');
    return row;
  }
  /** 提交前持久化，显式401重放允许保持同一submitting。
   * @param id 当前尝试。
   * @param signal 派发停止信号。
   * @returns 不适用。
   * @throws Error 取消、Run不可执行或数据库失败。
   */
  submitting(id: string, signal: AbortSignal): void {
    signal.throwIfAborted();
    const run = this.db
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, this.run.id))
      .get();
    if (run?.status !== 'executing') throw new Error('Run no longer executing');
    const row = this.get(id);
    if (row.status === 'submitting') return;
    if (row.status !== 'pending')
      throw new Error('Operation no longer pending');
    const now = Date.now();
    this.transition(id, {
      status: 'submitting',
      submittedAt: now,
      updatedAt: now,
    });
  }

  /** 在任何chunk之前保存init响应。
   * @param id 当前尝试。
   * @param session 有效session。
   * @returns 不适用。
   * @throws Error 数据库失败或非法状态。
   */
  session(id: string, session: MultipartSnapshot): void {
    const current = this.get(id);
    if (
      current.status === 'running' &&
      (current.multipartUploadId !== session.uploadId ||
        current.multipartAttempt !== session.attempt)
    )
      throw new Error('Multipart identity changed during persistence');
    if (!['submitting', 'running'].includes(current.status))
      throw new Error('Session outside submitting');
    this.transition(id, {
      status: 'running',
      multipartUploadId: session.uploadId,
      multipartChunkSize: session.chunkSize,
      multipartState: session.state,
      multipartAttempt: session.attempt,
      updatedAt: Date.now(),
    });
  }

  /** 在最后chunk或空put之前记录精确源EOF。
   * @param id 当前尝试。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  eof(id: string): void {
    this.db
      .update(operationAttempts)
      .set({ sourceStreamCompletedAt: Date.now(), updatedAt: Date.now() })
      .where(eq(operationAttempts.id, id))
      .run();
  }
  /** remove成功响应先落库，确认读随后进行。
   * @param id delete ID。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  confirming(id: string): void {
    if (this.get(id).status === 'submitting')
      this.transition(id, { status: 'running', updatedAt: Date.now() });
  }
  /** 同步推进当前尝试与逻辑操作的非终态；旧尝试不得覆盖新结果。
   * @param id Attempt ID。
   * @param changes 尝试检查点及状态。
   * @returns 不适用。
   * @throws Error 尝试已结束、身份不符或数据库失败。
   */
  transition(
    id: string,
    changes: Partial<typeof operationAttempts.$inferInsert>,
  ): void {
    this.db.transaction(
      /** 校验仍为当前在途尝试后，同批写入尝试检查点与父状态。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 尝试已结束或数据库失败。
       */
      () => {
        const row = this.get(id);
        if (
          row.attemptNo !== row.attemptCount ||
          !['pending', 'submitting', 'submitted', 'running'].includes(
            row.status,
          )
        )
          throw new Error('Attempt no longer current');
        this.db
          .update(operationAttempts)
          .set(changes)
          .where(eq(operationAttempts.id, id))
          .run();
        this.db
          .update(operations)
          .set({
            status: changes.status ?? row.status,
            updatedAt: changes.updatedAt ?? Date.now(),
          })
          .where(eq(operations.id, row.operationId))
          .run();
      },
    );
  }
  /** 原子结束一次尝试并决定是否安排下一次；失败历史和pending父状态一起提交。
   * @param id 当前Attempt ID。
   * @param outcome 已完成分类的结果。
   * @param retryable 调用方确认失败可安全重试，恢复及批量收尾恒为false。
   * @param stopping 已停止派发的信号，阻止新尝试。
   * @returns 本次是否实际提交；迟到完成返回false。
   * @throws Error 数据库失败，结果及重试安排一起回滚。
   */
  end(
    id: string,
    outcome: Outcome,
    retryable = false,
    stopping?: AbortSignal,
  ): boolean {
    return this.db.transaction(
      /** 写入尝试终态，并在同一事务内安排下一次尝试或收尾逻辑操作。
       * @param 不适用。
       * @returns 是否实际写入。
       * @throws Error 数据库失败。
       */
      () => {
        const row = this.get(id);
        if (
          row.attemptNo !== row.attemptCount ||
          !['pending', 'submitting', 'submitted', 'running'].includes(
            row.status,
          )
        )
          return false;
        const now = Date.now();
        const run = this.db
          .select({ status: runs.status })
          .from(runs)
          .where(eq(runs.id, this.run.id))
          .get();
        const retry =
          outcome.status === 'failed' &&
          retryable &&
          !stopping?.aborted &&
          run?.status === 'executing' &&
          row.attemptNo < this.run.config.settings.retryMaxAttempts;
        this.db
          .update(operationAttempts)
          .set({
            status: outcome.status,
            errorCode: outcome.code ?? null,
            errorMessage: outcome.message ?? outcome.code ?? null,
            endedAt: now,
            updatedAt: now,
            remoteCleanupPending: sql`CASE WHEN openlist_task_id IS NOT NULL THEN 1 ELSE 0 END`,
            unknownSince: outcome.status === 'unknown' ? now : null,
          })
          .where(eq(operationAttempts.id, id))
          .run();
        if (retry)
          this.db
            .insert(operationAttempts)
            .values({
              id: randomUUID(),
              operationId: row.operationId,
              targetInstanceId: row.targetInstanceId,
              method: row.method,
              attemptNo: row.attemptNo + 1,
              createdAt: now,
              updatedAt: now,
              nextAttemptAt:
                now + backoffMs(this.run.config.settings, row.attemptNo),
            })
            .run();
        this.db
          .update(operations)
          .set({
            status: retry ? 'pending' : outcome.status,
            attemptCount: row.attemptNo + (retry ? 1 : 0),
            updatedAt: now,
            endedAt: retry ? null : now,
          })
          .where(eq(operations.id, row.operationId))
          .run();
        return true;
      },
    );
  }
  /** 按稳定操作ID读取当前尝试，用于协调器推进已安排的重试。
   * @param operationId 逻辑操作ID。
   * @returns 当前尝试上下文。
   * @throws Error 操作缺失或数据库失败。
   */
  current(operationId: string): ExecutionRecord {
    const row = this.db
      .select(executionColumns)
      .from(operations)
      .innerJoin(operationAttempts, currentAttempt)
      .where(
        and(eq(operations.id, operationId), eq(operations.runId, this.run.id)),
      )
      .get();
    if (!row) throw new Error('Current attempt missing');
    return row;
  }
  /** 正常缺失时显式移除下游对此delete的依赖。
   * @param id delete ID。
   * @returns 不适用。
   * @throws Error 事务失败。
   */
  absent(id: string): void {
    this.db.transaction(
      /** 原子保存正常缺失并移除该delete的下游依赖边。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 数据库失败。
       */
      () => {
        this.end(id, {
          status: 'skipped',
          code: 'PRECONDITION_ALREADY_ABSENT',
        });
        this.db
          .delete(operationDependencies)
          .where(
            eq(operationDependencies.dependsOnId, this.get(id).operationId),
          )
          .run();
      },
    );
  }
  /** 为一次新的create attempt建立唯一清理动作。
   * @param create 当前待重试create。
   * @param size 当前残留文件大小。
   * @param budget 目标固定预算，null不限。
   * @param planned 初始R预留数。
   * @returns cleanup或null（预算耗尽）。
   * @throws Error 事务失败。
   */
  cleanup(
    create: ExecutionRecord,
    size: number,
    budget: number | null,
    planned: number,
  ): ExecutionRecord | null {
    return this.db.transaction(
      /** 按累计逻辑清理数量预留剩余预算并建立cleanup依赖。
       * @param 不适用。
       * @returns 新cleanup动作或预算不足的null。
       * @throws Error 数据库失败。
       */
      () => {
        const used =
          this.cleanupCounts.get(create.runTargetId) ??
          (budget === null
            ? 0
            : (this.db
                .select({ n: sql<number>`count(*)` })
                .from(operations)
                .where(
                  and(
                    eq(operations.runTargetId, create.runTargetId),
                    eq(operations.reason, 'retry_cleanup'),
                  ),
                )
                .get()?.n ?? 0));
        if (budget !== null && used >= budget - planned) return null;
        const now = Date.now();
        const id = randomUUID();
        insertOperation(this.db, {
          id,
          runId: create.runId,
          runTargetId: create.runTargetId,
          seq: this.nextSeq(),
          action: 'delete',
          method: 'remove',
          reason: 'retry_cleanup',
          targetInstanceId: create.targetInstanceId,
          targetPath: create.targetPath,
          isDir: false,
          expectedTargetSize: size,
          affectedFileCount: 1,
          affectedBytes: size,
          createdAt: now,
          updatedAt: now,
        });
        const row = this.current(id);
        this.cleanupCounts.set(create.runTargetId, used + 1);
        this.db
          .insert(operationDependencies)
          .values({
            operationId: create.operationId,
            dependsOnId: row.operationId,
          })
          .run();
        return row;
      },
    );
  }
  /** 取得必要依赖的小集合。
   * @param id 当前Attempt ID。
   * @returns 依赖动作，最多父mkdir和对应delete。
   * @throws Error 数据库失败。
   */
  dependencies(id: string): ExecutionRecord[] {
    return this.db
      .select(executionColumns)
      .from(operationDependencies)
      .innerJoin(
        operations,
        eq(operations.id, operationDependencies.dependsOnId),
      )
      .innerJoin(operationAttempts, currentAttempt)
      .where(eq(operationDependencies.operationId, this.get(id).operationId))
      .all();
  }
  /** 按稳定计划顺序取得当前阶段的pending逻辑动作及其当前尝试。
   * @param targetId 当前目标。
   * @param phase 准备、创建、文件extras或目录extras。
   * @param after 只返回seq大于该值的行；-1表示从头读取。
   * @param limit 本次读取的行数，只约束内存，不约束执行并发。
   * @returns 按seq排序的有界读取页。
   * @throws Error 数据库失败。
   */
  pending(
    targetId: string,
    phase: 'mkdir' | 'create' | 'files' | 'directories',
    after: number,
    limit: number,
  ): ExecutionRecord[] {
    const condition =
      phase === 'mkdir' || phase === 'create'
        ? eq(operations.action, phase)
        : and(
            eq(operations.reason, 'extra'),
            eq(operations.isDir, phase === 'directories'),
          );
    return this.db
      .select(executionColumns)
      .from(operations)
      .innerJoin(operationAttempts, currentAttempt)
      .where(
        and(
          eq(operations.runTargetId, targetId),
          eq(operations.status, 'pending'),
          gt(operations.seq, after),
          condition,
          phase === 'mkdir'
            ? sql`NOT EXISTS (SELECT 1 FROM operation_dependencies dep JOIN operations parent ON parent.id = dep.depends_on_id WHERE dep.operation_id = operations.id AND parent.status IN ('pending','submitting','submitted','running'))`
            : undefined,
        ),
      )
      .orderBy(asc(operations.seq))
      .limit(limit)
      .all();
  }
  /** 从已落库的seq分配后续值，调用者处于同步短事务中。
   * @param 不适用。
   * @returns 下一个Run内序号。
   * @throws Error 数据库失败。
   */
  private nextSeq(): number {
    return (
      (this.db
        .select({ n: max(operations.seq) })
        .from(operations)
        .where(eq(operations.runId, this.run.id))
        .get()?.n ?? 0) + 1
    );
  }
  /** 终态时保存本尝试的传输字节。
   * @param id 当前尝试。
   * @param downloaded 已下载字节，含续传。
   * @param transferred 已发送payload，含重传。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  bytes(id: string, downloaded: number, transferred: number): void {
    this.db
      .update(operationAttempts)
      .set({
        bytesDownloaded: downloaded,
        bytesTransferred: transferred,
        updatedAt: Date.now(),
      })
      .where(eq(operationAttempts.id, id))
      .run();
  }
}
