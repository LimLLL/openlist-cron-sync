// 提供可取消的进程内配额；按优先级和进入顺序派发。
import { setTimeout as delay } from 'node:timers/promises';

/** 等待取得一个并发位的请求。 */
interface Waiter {
  /** 较小值优先；已有传输的进展先于预读。 */
  priority: number;
  /** 发放幂等释放函数。 */
  resolve: (release: () => void) => void;
  /** 撤销取消监听。 */
  cleanup: () => void;
}
/** 一个具体并发资源池。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class Permits {
  private active = 0;
  private readonly waiting: Waiter[] = [];
  /** 固定此资源池的最大并发。
   * @param capacity 并发上限，必须为正整数。
   * @returns 不适用。
   * @throws RangeError 非法上限。
   */
  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new RangeError('Invalid permit capacity');
  }
  /** 等待名额；取消立即从等待队列移除。
   * @param signal 当前工作的停止信号。
   * @param priority 排队优先级，默认普通工作。
   * @returns 幂等释放函数。
   * @throws Error 等待被取消。
   */
  acquire(signal: AbortSignal, priority = 1): Promise<() => void> {
    signal.throwIfAborted();
    return new Promise(
      /** 登记一个可取消的资源等待者并尝试发放空闲名额。
       * @param resolve 发放结果的完成回调。
       * @param reject 交付失败的回调。
       * @returns 不适用。
       * @throws 不适用。
       */
      (resolve, reject) => {
        /** 撤销本等待的监听。
         * @param 不适用。
         * @returns 不适用。
         * @throws 不适用。
         */
        const cleanup = (): void => signal.removeEventListener('abort', abort);
        const entry: Waiter = { priority, resolve, cleanup };
        /** 中止未发放的等待。
         * @param 不适用。
         * @returns 不适用。
         * @throws 不适用。
         */
        const abort = (): void => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          cleanup();
          reject(signal.reason);
        };
        signal.addEventListener('abort', abort, { once: true });
        this.waiting.push(entry);
        this.waiting.sort(
          /** 按较小优先级优先排序，稳定排序保留同级FIFO。
           * @param a 左侧比较值。
           * @param b 右侧比较值。
           * @returns 排序差值。
           * @throws 不适用。
           */
          (a, b) => a.priority - b.priority,
        );
        this.drain();
      },
    );
  }
  /** 向尚未取消的等待者发放空闲位置。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  private drain(): void {
    while (this.active < this.capacity) {
      const entry = this.waiting.shift();
      if (!entry) return;
      this.active++;
      entry.cleanup();
      let released = false;
      entry.resolve(
        /** 只归还一次并发位并唤醒下一等待者。
         * @param 不适用。
         * @returns 不适用。
         * @throws 不适用。
         */
        () => {
          if (released) return;
          released = true;
          this.active--;
          this.drain();
        },
      );
    }
  }
}
/** 按单调时钟聚合一个 Job 的全部上传 payload。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class BandwidthBucket {
  private tokens: number;
  private updated = performance.now();
  /** 建立一秒容量的桶。
   * @param rate 每秒字节数；0表示不限。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(readonly rate: number) {
    this.tokens = rate;
  }
  /** 取得一个永远不大于桶容量的 payload 额度。
   * @param remaining 当前缓冲区剩余字节。
   * @param signal 上传停止信号。
   * @returns 允许发送的字节数。
   * @throws Error 等待取消。
   */
  async take(remaining: number, signal: AbortSignal): Promise<number> {
    const size = Math.min(remaining, 65536, this.rate || 65536);
    if (!this.rate) return size;
    for (;;) {
      signal.throwIfAborted();
      const now = performance.now();
      this.tokens = Math.min(
        this.rate,
        this.tokens + ((now - this.updated) * this.rate) / 1000,
      );
      this.updated = now;
      if (this.tokens >= size) {
        this.tokens -= size;
        return size;
      }
      await delay(
        Math.max(1, Math.ceil(((size - this.tokens) * 1000) / this.rate)),
        undefined,
        { signal },
      );
    }
  }
}
