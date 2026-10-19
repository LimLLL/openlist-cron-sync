// 按实例限制管理 API 并发与请求速率，控制请求优先取得名额。
import { Injectable } from '@nestjs/common';

/** 配额输入，仅包含已经验证的有效值。 */
export interface ApiLimits {
  /** 实例 UUID。 */
  id: string;
  /** 最大同时请求数。 */
  maxApiConcurrency: number;
  /** 每秒请求数；按间隔平滑发放。 */
  apiRequestsPerSecond: number;
}
/** 等待中的单个 HTTP 请求。 */
interface Waiter {
  /** 是否为登录、查询或取消等控制请求。 */
  control: boolean;
  /** 取得名额后的完成回调。 */
  resolve: (release: () => void) => void;
  /** 解除取消监听。 */
  cleanup: () => void;
}
/** 一个实例的进程内配额。 */
interface Pool {
  /** 已取得的名额数。 */
  active: number;
  /** 下次可开始时间。 */
  nextAt: number;
  /** 当前有效配额。 */
  limits: ApiLimits;
  /** 等待队列。 */
  queue: Waiter[];
  /** 速率等待计时器。 */
  timer?: ReturnType<typeof setTimeout>;
}
/** 管理 API 配额叶子服务。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class ApiQuota {
  private readonly pools = new Map<string, Pool>();
  /** 为一次 HTTP 请求等待并发位与速率许可。
   * @param limits 实例配额。
   * @param control 控制请求优先；提交请求不耗尽保留位置。
   * @param signal 请求期限或取消信号。
   * @returns 幂等释放函数。
   * @throws Error 等待被取消。
   */
  acquire(
    limits: ApiLimits,
    control: boolean,
    signal: AbortSignal,
  ): Promise<() => void> {
    signal.throwIfAborted();
    let pool = this.pools.get(limits.id);
    if (!pool) {
      pool = { active: 0, nextAt: 0, limits, queue: [] };
      this.pools.set(limits.id, pool);
    }
    pool.limits = limits;
    const current = pool;
    return new Promise(
      /** 注册可取消的队列项。
       * @param resolve 名额回调。
       * @param reject 取消回调。
       * @returns 不适用。
       * @throws 不适用。
       */
      (resolve, reject) => {
        const waiter: Waiter = { control, resolve, cleanup };
        /** 移除取消监听。
         * @param 不适用。
         * @returns 不适用。
         * @throws 不适用。
         */
        function cleanup(): void {
          signal.removeEventListener('abort', abort);
        }
        /** 取消尚未派发的等待。
         * @param 不适用。
         * @returns 不适用。
         * @throws 不适用。
         */
        const abort = (): void => {
          const index = current.queue.indexOf(waiter);
          if (index >= 0) current.queue.splice(index, 1);
          cleanup();
          reject(signal.reason);
          this.drain(current);
        };
        signal.addEventListener('abort', abort, { once: true });
        current.queue.push(waiter);
        this.drain(current);
      },
    );
  }
  /** 以控制优先、同优先级 FIFO 的顺序派发。
   * @param pool 实例配额。
   * @returns 不适用。
   * @throws 不适用。
   */
  private drain(pool: Pool): void {
    if (pool.timer) clearTimeout(pool.timer);
    pool.timer = undefined;
    const controlIndex = pool.queue.findIndex(isControl);
    const index = controlIndex < 0 ? 0 : controlIndex;
    const waiter = pool.queue[index];
    if (!waiter) {
      if (pool.active === 0) {
        const remaining = pool.nextAt - performance.now();
        if (remaining <= 0) this.pools.delete(pool.limits.id);
        else
          pool.timer = setTimeout(
            /** 速率窗口结束后释放空闲实例，不让短时重建绕过限速。
             * @param 不适用。
             * @returns 不适用。
             * @throws 不适用。
             */
            () => this.drain(pool),
            remaining,
          ).unref();
      }
      return;
    }
    const capacity = waiter.control
      ? pool.limits.maxApiConcurrency
      : Math.max(1, pool.limits.maxApiConcurrency - 1);
    if (pool.active >= capacity) return;
    const delay = pool.nextAt - performance.now();
    if (delay > 0) {
      pool.timer = setTimeout(
        /** 到达速率窗口后重新派发。
         * @param 不适用。
         * @returns 不适用。
         * @throws 不适用。
         */
        () => this.drain(pool),
        delay,
      );
      return;
    }
    pool.queue.splice(index, 1);
    waiter.cleanup();
    pool.active++;
    pool.nextAt = performance.now() + 1000 / pool.limits.apiRequestsPerSecond;
    let released = false;
    waiter.resolve(
      /** 释放一次持有的并发位。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      () => {
        if (released) return;
        released = true;
        pool.active--;
        this.drain(pool);
      },
    );
    this.drain(pool);
  }
}
/** 判断控制队列项。
 * @param waiter 等待项。
 * @returns 是否为控制请求。
 * @throws 不适用。
 */
function isControl(waiter: Waiter): boolean {
  return waiter.control;
}
