// 维护copy提交额度和逐tid所有权；重启只从Operation责任恢复。
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { operations, operationAttempts } from '../database/operation-schema.js';
import { runTargets } from '../database/run-schema.js';

/** 等待copy额度的调用。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
interface TaskWaiter {
  /** 尝试Operation ID。 */ id: string;
  /** 稳定Target ID。 */ targetId: string;
  /** 本Run固定的Target文件并发；0表示不限。 */ capacity: number;
  /** 发放额度。 */ resolve: () => void;
  /** 解除中止监听。 */ dispose: () => void;
}
/** 单进程task资源；按 Target 文件并发管理任务责任，不限制 HTTP 请求。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class TaskResources {
  private readonly occupied = new Map<string, string>();
  private readonly owners = new Set<string>();
  private readonly cancelled = new Set<string>();
  private readonly recoveryCancels = new Map<string, AbortController>();
  private readonly waiting: TaskWaiter[] = [];
  /** 保存恢复所需数据库。
   * @param database 共享连接。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  /** 启动开放派发前按稳定Target恢复全部仍承担task责任的名额，允许超过当前容量。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  restore(): void {
    // 两类责任分别走清理及在途部分索引，避免启动时扫描全部历史尝试。
    for (const cleanup of [true, false]) {
      const cursorColumn = cleanup
        ? operationAttempts.id
        : operationAttempts.operationId;
      // 首个IN逐字重复attempts_active的部分索引谓词：SQLite只在WHERE能直接推出该谓词时才使用部分索引。
      const owned = cleanup
        ? sql`${operationAttempts.remoteCleanupPending}=1`
        : sql`${operationAttempts.status} IN ('pending','submitting','submitted','running') AND ${operationAttempts.status} IN ('submitted','running')`;
      // 在途部分索引以operation_id为键，沿相同键分页才能避免按Attempt ID扫描整段历史。
      let after = '';
      for (;;) {
        const rows = this.database.db
          .select({
            id: operationAttempts.id,
            cursor: cursorColumn,
            targetId: runTargets.targetId,
          })
          .from(operationAttempts)
          .innerJoin(
            operations,
            eq(operations.id, operationAttempts.operationId),
          )
          .innerJoin(runTargets, eq(runTargets.id, operations.runTargetId))
          .where(
            and(
              owned,
              gt(cursorColumn, after),
              isNotNull(operationAttempts.openlistTaskId),
              sql`(${operationAttempts.remoteState} IS NULL OR ${operationAttempts.remoteState} NOT IN (2,4,7))`,
            ),
          )
          .orderBy(asc(cursorColumn))
          .limit(128)
          .all();
        if (!rows.length) break;
        for (const row of rows) {
          after = row.cursor;
          this.occupied.set(row.id, row.targetId);
        }
      }
    }
  }
  /** 查询Run Target所属稳定Target当前已占额度，包括恢复、旧Run遗留及未知tid。
   * @param runTargetId Run Target ID。
   * @returns 已占数量。
   * @throws Error Run Target不存在。
   */
  count(runTargetId: string): number {
    return this.occupiedBy(this.targetKey(runTargetId));
  }
  /** 统计一个稳定Target的已占额度。
   * @param targetId 稳定Target ID。
   * @returns 已占数量。
   * @throws 不适用。
   */
  private occupiedBy(targetId: string): number {
    let count = 0;
    for (const id of this.occupied.values()) if (id === targetId) count++;
    return count;
  }
  /** 把Run Target映射到稳定Target，使旧Run的未知任务继续占用后续Run的额度。
   * @param runTargetId Run Target ID。
   * @returns 稳定Target ID。
   * @throws Error Run Target不存在。
   */
  private targetKey(runTargetId: string): string {
    const row = this.database.db
      .select({ targetId: runTargets.targetId })
      .from(runTargets)
      .where(eq(runTargets.id, runTargetId))
      .get();
    if (!row) throw new Error('Task target missing');
    return row.targetId;
  }
  /** 记录已知远程非终态，不等待新提交容量。
   * @param attemptId 原尝试ID。
   * @param runTargetId 操作所属Run Target。
   * @returns 不适用。
   * @throws Error Run Target不存在。
   */
  hold(attemptId: string, runTargetId: string): void {
    this.occupied.set(attemptId, this.targetKey(runTargetId));
  }
  /** 幂等释放已结束或放弃跟踪的额度。
   * @param attemptId 尝试ID。
   * @returns 不适用。
   * @throws 不适用。
   */
  release(attemptId: string): void {
    this.occupied.delete(attemptId);
    this.drain();
  }
  /** 在删除旧文件之前取得潜在copy task名额。
   * @param runTargetId 操作所属Run Target。
   * @param capacity 本Run固定的Target文件并发；0表示不限。
   * @param id 尝试ID。
   * @param signal Run停止。
   * @returns 额度已经预留。
   * @throws Error 等待被取消或Run Target不存在。
   */
  async reserve(
    runTargetId: string,
    capacity: number,
    id: string,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const targetId = this.targetKey(runTargetId);
    await new Promise<void>(
      /** 登记可取消的FIFO等待。
       * @param resolve 发放回调。
       * @param reject 中止回调。
       * @returns 不适用。
       * @throws 不适用。
       */
      (resolve, reject) => {
        const entry: TaskWaiter = {
          id,
          targetId,
          capacity,
          resolve,
          dispose,
        };
        /** 解除监听。
         * @param 不适用。
         * @returns 不适用。
         * @throws 不适用。
         */
        function dispose(): void {
          signal.removeEventListener('abort', abort);
        }
        /** 撤销尚未发放的额度。
         * @param 不适用。
         * @returns 不适用。
         * @throws 不适用。
         */
        const abort = (): void => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          dispose();
          reject(signal.reason);
        };
        signal.addEventListener('abort', abort, { once: true });
        this.waiting.push(entry);
        this.drain();
      },
    );
  }
  /** 向各Target尚有空间的等待者发放，等待期间不提交远程请求。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  private drain(): void {
    for (let index = 0; index < this.waiting.length;) {
      const entry = this.waiting[index];
      if (
        entry.capacity !== 0 &&
        this.occupiedBy(entry.targetId) >= entry.capacity
      ) {
        index++;
        continue;
      }
      this.waiting.splice(index, 1);
      entry.dispose();
      this.occupied.set(entry.id, entry.targetId);
      entry.resolve();
    }
  }
  /** 取得一次tid跟踪的独占所有权，已有owner返回null。
   * @param instanceId 实例ID。
   * @param tid 上游ID。
   * @returns 幂等释放函数或null。
   * @throws 不适用。
   */
  own(instanceId: string, tid: string): (() => void) | null {
    const key = JSON.stringify([instanceId, tid]);
    if (this.owners.has(key)) return null;
    this.owners.add(key);
    return this.owners.delete.bind(this.owners, key);
  }
  /** 为恢复Run提供只打断普通info等待的取消广播。
   * @param runId recovering Run ID。
   * @returns 用户取消信号，不等同于进程关闭。
   * @throws 不适用。
   */
  recoveryCancelSignal(runId: string): AbortSignal {
    let controller = this.recoveryCancels.get(runId);
    if (!controller) {
      controller = new AbortController();
      this.recoveryCancels.set(runId, controller);
    }
    return controller.signal;
  }
  /** 持久化取消意图后唤醒恢复tracker，使其立即进入固定宽限。
   * @param runId recovering Run ID。
   * @returns 不适用。
   * @throws 不适用。
   */
  notifyCancel(runId: string): void {
    this.recoveryCancels.get(runId)?.abort();
  }
  /** Run恢复结束后释放取消广播。
   * @param runId 已结束恢复Run。
   * @returns 不适用。
   * @throws 不适用。
   */
  forgetRun(runId: string): void {
    this.recoveryCancels.delete(runId);
  }
  /** 每tid每进程只允许一个cancel尝试，不把响应当停止证据。
   * @param instanceId 实例ID。
   * @param tid 上游ID。
   * @returns 本次是否首次尝试。
   * @throws 不适用。
   */
  cancelOnce(instanceId: string, tid: string): boolean {
    const key = JSON.stringify([instanceId, tid]);
    if (this.cancelled.has(key)) return false;
    this.cancelled.add(key);
    return true;
  }
}
