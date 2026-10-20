// 原子保存操作结果和有界重试依赖；不在数据库事务中执行网络请求。
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, max, or, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  operations,
  operationDependencies,
} from '../database/operation-schema.js';
import type { OperationRecord } from '../database/operation-schema.js';
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
  /** 取得操作当前持久化状态。
   * @param id 操作ID。
   * @returns 完整操作。
   * @throws Error 记录缺失。
   */
  get(id: string): OperationRecord {
    const row = this.db
      .select()
      .from(operations)
      .where(and(eq(operations.id, id), eq(operations.runId, this.run.id)))
      .get();
    if (!row) throw new Error('Operation missing');
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
    this.db
      .update(operations)
      .set({ status: 'submitting', submittedAt: now, updatedAt: now })
      .where(eq(operations.id, id))
      .run();
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
    this.db
      .update(operations)
      .set({
        status: 'running',
        multipartUploadId: session.uploadId,
        multipartChunkSize: session.chunkSize,
        multipartState: session.state,
        multipartAttempt: session.attempt,
        updatedAt: Date.now(),
      })
      .where(eq(operations.id, id))
      .run();
  }
  /** 在最后chunk或空put之前记录精确源EOF。
   * @param id 当前尝试。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  eof(id: string): void {
    this.db
      .update(operations)
      .set({ sourceStreamCompletedAt: Date.now(), updatedAt: Date.now() })
      .where(eq(operations.id, id))
      .run();
  }
  /** remove成功响应先落库，确认读随后进行。
   * @param id delete ID。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  confirming(id: string): void {
    this.db
      .update(operations)
      .set({ status: 'running', updatedAt: Date.now() })
      .where(and(eq(operations.id, id), eq(operations.status, 'submitting')))
      .run();
  }
  /** 只从非终态写一次结果，unknown时间同时提交。
   * @param id 当前操作。
   * @param outcome 受控结果。
   * @returns 是否实际写入，迟到结果返回false。
   * @throws Error 数据库失败。
   */
  end(id: string, outcome: Outcome): boolean {
    const now = Date.now();
    return (
      this.db
        .update(operations)
        .set({
          status: outcome.status,
          errorCode: outcome.code ?? null,
          errorMessage: outcome.message ?? outcome.code ?? null,
          endedAt: now,
          updatedAt: now,
          unknownSince: outcome.status === 'unknown' ? now : null,
          unknownUntil:
            outcome.status === 'unknown'
              ? now + this.run.config.settings.quarantineSeconds * 1000
              : null,
        })
        .where(
          and(
            eq(operations.id, id),
            inArray(operations.status, [
              'pending',
              'submitting',
              'submitted',
              'running',
            ]),
          ),
        )
        .run().changes === 1
    );
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
          .where(eq(operationDependencies.dependsOnId, id))
          .run();
      },
    );
  }
  /** 为失败尝试创建新行并重连尚未执行的下游。
   * @param previous 已失败操作。
   * @returns 新pending尝试，预算耗尽返回null。
   * @throws Error 数据库或状态非法。
   */
  retry(previous: OperationRecord): OperationRecord | null {
    if (
      previous.status !== 'failed' ||
      previous.attemptNo >= this.run.config.settings.retryMaxAttempts
    )
      return null;
    return this.db.transaction(
      /** 在同一事务追加重试attempt并重连尚未执行的下游。
       * @param 不适用。
       * @returns 新pending尝试。
       * @throws Error 数据库失败。
       */
      () => {
        const id = randomUUID();
        const now = Date.now();
        const next: OperationRecord = {
          ...previous,
          id,
          seq: this.nextSeq(),
          retryOf: previous.retryOf ?? previous.id,
          attemptNo: previous.attemptNo + 1,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          submittedAt: null,
          endedAt: null,
          nextAttemptAt:
            now + backoffMs(this.run.config.settings, previous.attemptNo),
          errorCode: null,
          errorMessage: null,
          multipartUploadId: null,
          multipartChunkSize: null,
          multipartState: null,
          multipartAttempt: null,
          sourceStreamCompletedAt: null,
          bytesDownloaded: 0,
          bytesTransferred: 0,
        };
        this.db.insert(operations).values(next).run();
        for (const dependency of this.db
          .select()
          .from(operationDependencies)
          .where(eq(operationDependencies.operationId, previous.id))
          .all())
          this.db
            .insert(operationDependencies)
            .values({ operationId: id, dependsOnId: dependency.dependsOnId })
            .run();
        // 重试仍属于同一逻辑顶点；只替换其下游边，不新增反向逻辑边，因此不依赖seq证明无环。
        this.db
          .update(operationDependencies)
          .set({ dependsOnId: id })
          .where(
            and(
              eq(operationDependencies.dependsOnId, previous.id),
              sql`${operationDependencies.operationId} IN (SELECT id FROM operations WHERE status = 'pending')`,
            ),
          )
          .run();
        return next;
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
    create: OperationRecord,
    size: number,
    budget: number | null,
    planned: number,
  ): OperationRecord | null {
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
                    isNull(operations.retryOf),
                  ),
                )
                .get()?.n ?? 0));
        if (budget !== null && used >= budget - planned) return null;
        const now = Date.now();
        const row: OperationRecord = {
          ...create,
          id: randomUUID(),
          seq: this.nextSeq(),
          action: 'delete',
          method: 'remove',
          reason: 'retry_cleanup',
          sourceInstanceId: null,
          sourcePath: null,
          expectedSourceSize: null,
          expectedSourceModified: null,
          expectedTargetSize: size,
          affectedBytes: size,
          retryOf: null,
          attemptNo: 1,
          nextAttemptAt: null,
          createdAt: now,
          updatedAt: now,
        };
        this.db.insert(operations).values(row).run();
        this.cleanupCounts.set(create.runTargetId, used + 1);
        this.db
          .insert(operationDependencies)
          .values({ operationId: create.id, dependsOnId: row.id })
          .run();
        return row;
      },
    );
  }
  /** 取得必要依赖的小集合。
   * @param id 当前动作。
   * @returns 依赖动作，最多父mkdir和对应delete。
   * @throws Error 数据库失败。
   */
  dependencies(id: string): OperationRecord[] {
    return this.db
      .select({ operation: operations })
      .from(operationDependencies)
      .innerJoin(
        operations,
        eq(operations.id, operationDependencies.dependsOnId),
      )
      .where(eq(operationDependencies.operationId, id))
      .all()
      .map(
        /** 从依赖查询结果中提取完整操作。
         * @param row 当前查询记录。
         * @returns 依赖操作记录。
         * @throws 不适用。
         */
        (row) => row.operation,
      );
  }
  /** 当前逻辑动作的最后尝试。
   * @param row 任一尝试。
   * @returns 最后attempt。
   * @throws Error 数据库失败。
   */
  latest(row: OperationRecord): OperationRecord {
    const root = row.retryOf ?? row.id;
    return (
      this.db
        .select()
        .from(operations)
        .where(
          and(
            eq(operations.targetInstanceId, row.targetInstanceId),
            eq(operations.targetPath, row.targetPath),
            eq(operations.runId, row.runId),
            or(eq(operations.id, root), eq(operations.retryOf, root)),
          ),
        )
        .orderBy(desc(operations.attemptNo))
        .limit(1)
        .get() ?? row
    );
  }
  /** 取得一个目标当前阶段的pending小批次，重试行同样参与。
   * @param targetId 当前目标。
   * @param phase 准备、创建、文件extras或目录extras。
   * @returns 按计划顺序的有界批次。
   * @throws Error 数据库失败。
   */
  pending(
    targetId: string,
    phase: 'mkdir' | 'create' | 'files' | 'directories',
  ): OperationRecord[] {
    const condition =
      phase === 'mkdir' || phase === 'create'
        ? eq(operations.action, phase)
        : and(
            eq(operations.reason, 'extra'),
            eq(operations.isDir, phase === 'directories'),
          );
    return this.db
      .select()
      .from(operations)
      .where(
        and(
          eq(operations.runTargetId, targetId),
          eq(operations.status, 'pending'),
          condition,
          phase === 'mkdir'
            ? sql`NOT EXISTS (SELECT 1 FROM operation_dependencies dep JOIN operations parent ON parent.id = dep.depends_on_id WHERE dep.operation_id = operations.id AND parent.status IN ('pending','submitting','submitted','running'))`
            : undefined,
        ),
      )
      .orderBy(asc(operations.seq))
      .limit(phase === 'directories' ? 1 : 4)
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
      .update(operations)
      .set({
        bytesDownloaded: downloaded,
        bytesTransferred: transferred,
        updatedAt: Date.now(),
      })
      .where(eq(operations.id, id))
      .run();
  }
}
