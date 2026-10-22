// 维护copy提交额度和逐tid所有权；重启只从Operation责任恢复。
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { operations } from '../database/operation-schema.js';
import type { InstanceRecord } from '../database/schema.js';

/** 等待copy额度的调用。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
interface TaskWaiter {
  /** 尝试Operation ID。 */ id: string;
  /** 同实例共享限制。 */ instance: InstanceRecord;
  /** 发放额度。 */ resolve: () => void;
  /** 解除中止监听。 */ dispose: () => void;
}
/** 单进程task资源；API请求额度由OpenList客户端另行取得。
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
  /** 启动开放派发前恢复全部仍承担task责任的名额，允许超过当前容量。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  restore(): void {
    // 两类责任分别走remote_cleanup_pending与status前导索引，避免启动时扫描全部历史Operation。
    for (const owned of [
      eq(operations.remoteCleanupPending, true),
      inArray(operations.status, ['submitted', 'running']),
    ]) {
      let after = '';
      for (;;) {
        const rows = this.database.db
          .select({
            id: operations.id,
            instanceId: operations.targetInstanceId,
          })
          .from(operations)
          .where(
            and(
              owned,
              gt(operations.id, after),
              isNotNull(operations.openlistTaskId),
              sql`(${operations.remoteState} IS NULL OR ${operations.remoteState} NOT IN (2,4,7))`,
            ),
          )
          .orderBy(asc(operations.id))
          .limit(128)
          .all();
        if (!rows.length) break;
        for (const row of rows) {
          after = row.id;
          this.hold(row.id, row.instanceId);
        }
      }
    }
  }
  /** 查询实例当前已占额度，包括恢复及未知tid。
   * @param instanceId 实例ID。
   * @returns 已占数量。
   * @throws 不适用。
   */
  count(instanceId: string): number {
    let count = 0;
    for (const id of this.occupied.values()) if (id === instanceId) count++;
    return count;
  }
  /** 记录已知远程非终态，不等待新提交容量。
   * @param operationId 原尝试ID。
   * @param instanceId 固定实例。
   * @returns 不适用。
   * @throws 不适用。
   */
  hold(operationId: string, instanceId: string): void {
    this.occupied.set(operationId, instanceId);
  }
  /** 幂等释放已结束或放弃跟踪的额度。
   * @param operationId 尝试ID。
   * @returns 不适用。
   * @throws 不适用。
   */
  release(operationId: string): void {
    this.occupied.delete(operationId);
    this.drain();
  }
  /** 在删除旧文件之前取得潜在copy task名额。
   * @param instance 实例及固定额度。
   * @param id 尝试ID。
   * @param signal Run停止。
   * @returns 额度已经预留。
   * @throws Error 等待被取消。
   */
  async reserve(
    instance: InstanceRecord,
    id: string,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    await new Promise<void>(
      /** 登记可取消的FIFO等待。
       * @param resolve 发放回调。
       * @param reject 中止回调。
       * @returns 不适用。
       * @throws 不适用。
       */
      (resolve, reject) => {
        const entry: TaskWaiter = { id, instance, resolve, dispose };
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
  /** 向各实例尚有空间的等待者发放，不占API位等待。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  private drain(): void {
    for (let index = 0; index < this.waiting.length;) {
      const entry = this.waiting[index];
      if (
        entry.instance.maxOutstandingTasks !== 0 &&
        this.count(entry.instance.id) >= entry.instance.maxOutstandingTasks
      ) {
        index++;
        continue;
      }
      this.waiting.splice(index, 1);
      entry.dispose();
      this.hold(entry.id, entry.instance.id);
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
