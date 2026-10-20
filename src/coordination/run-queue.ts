// 持有单进程 FIFO 和执行位，不保存第二套持久化锁或任务状态。
import { Injectable } from '@nestjs/common';

/** 队列中仅保存派发所需的固定字段。 */
export interface QueueEntry {
  /** Run ID。 */
  id: string;
  /** 创建毫秒。 */
  createdAt: number;
  /** 原始排队截止毫秒。 */
  queueDeadlineAt: number;
}
/** M2 的执行位与全局 FIFO。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class RunQueue {
  /** 正在扫描/规划的 Run。 */
  readonly active = new Set<string>();
  /** 待启动候选；SQLite 是重启后的权威来源。 */
  readonly waiting: QueueEntry[] = [];
  /** 按规范键插入，避免同毫秒时取决于回调顺序。
   * @param entry 已提交的 Run。
   * @returns 不适用。
   * @throws 不适用。
   */
  enqueue(entry: QueueEntry): void {
    if (
      this.waiting.some(
        /** 检查该 Run 是否已在等待队列中。
         * @param row 已排队的条目。
         * @returns 是否与待插入 Run 同 ID。
         * @throws 不适用。
         */
        (row) => row.id === entry.id,
      )
    )
      return;
    // 调用方传入完整 Run；显式投影，避免队列额外保留配置与加密密码快照。
    this.waiting.push({
      id: entry.id,
      createdAt: entry.createdAt,
      queueDeadlineAt: entry.queueDeadlineAt,
    });
    this.waiting.sort(
      /** 按创建毫秒升序、同毫秒按 Run ID 字典序比较两个条目。
       * @param a 左侧队列条目。
       * @param b 右侧队列条目。
       * @returns 负数、零或正数表示的排序关系。
       * @throws 不适用。
       */
      (a, b) =>
        a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }
}
