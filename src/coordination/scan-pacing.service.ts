// 按 Instance 与全局路径首段共享扫描间隔，只串行化请求开始，不占用响应期容量。
import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { globalPath } from '../openlist/paths.js';

/** 调用方固定的目录请求间隔；不包含 Run 或 Target 标识。 */
export interface ScanInterval {
  /** Instance 与 storage 的无歧义组合。 */
  key: string;
  /** 当前调用方要求的最小开始间隔，整数秒，0–3600。 */
  seconds: number;
}

/** 用账号全局根推导 TaoSync 的 storage 分组，不依赖管理员挂载权限。
 * @param instance 固定的实例身份及账号全局根。
 * @param path 账号内绝对路径。
 * @param seconds 已验证的间隔秒数。
 * @returns 跨 Job、Target 和源/目标角色共享的分组。
 * @throws ApiError 路径不合法。
 */
export function scanInterval(
  instance: { id: string; accountBasePath: string | null },
  path: string,
  seconds: number,
): ScanInterval {
  const segment = globalPath(instance.accountBasePath ?? '/', path).split(
    '/',
  )[1];
  return { key: JSON.stringify([instance.id, segment || '/']), seconds };
}

/** 尚未取得派发顺序的请求。 */
interface Waiter {
  /** 本请求要求的间隔毫秒。 */
  intervalMs: number;
  /** 派发顺序已经取得；true 提交实际开始时间，false 撤销，重复调用无效。 */
  resolve: (finish: (started: boolean) => void) => void;
  /** 解除中止监听。 */
  cleanup: () => void;
  /** 调用方与服务关闭的组合信号。 */
  signal: AbortSignal;
}

/** 一个 storage 的 FIFO 开始队列；空闲时仍保留上次实际开始时间。 */
interface Starts {
  /** 单调时钟上的实际开始时间；首次请求没有历史时间。 */
  lastStart?: number;
  /** 已发放但尚未提交或撤销的派发顺序。 */
  active: boolean;
  /** 按到达顺序等待，不按 interval 或控制请求排序。 */
  queue: Waiter[];
  /** 当前队首间隔等待。 */
  timer?: ReturnType<typeof setTimeout>;
}

/** 单进程共享 pacing；不持久化、不限制在途 HTTP 数量。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class ScanPacing implements OnModuleDestroy {
  private readonly starts = new Map<string, Starts>();
  private readonly shutdown = new AbortController();

  /** 等待请求开始顺序；调用方必须在同步派发前提交，异常时撤销。
   * @param interval 当前请求的 storage 与固定间隔。
   * @param stop 停止派发信号，不能仅传入在途收尾期限。
   * @returns 幂等完成函数；true 记录实际开始，false 不更新时间。
   * @throws Error 等待或提交前被取消。
   */
  acquire(
    interval: ScanInterval,
    stop: AbortSignal,
  ): Promise<(started: boolean) => void> {
    const signal = AbortSignal.any([stop, this.shutdown.signal]);
    signal.throwIfAborted();
    let starts = this.starts.get(interval.key);
    if (!starts) {
      starts = { active: false, queue: [] };
      this.starts.set(interval.key, starts);
    }
    const current = starts;
    return new Promise(
      /** 注册 FIFO 等待及独立取消；仅发放开始顺序，不执行网络工作。
       * @param resolve 发放幂等的开始/撤销函数。
       * @param reject 返回调用方取消原因。
       * @returns 不适用。
       * @throws 不适用。
       */
      (resolve, reject) => {
        /** 移除当前等待的取消监听。
         * @param 不适用。
         * @returns 不适用。
         * @throws 不适用。
         */
        const cleanup = (): void => signal.removeEventListener('abort', abort);
        /** 撤销队列项并重新计算队首，取消不预留未来时间。
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
        const waiter: Waiter = {
          intervalMs: interval.seconds * 1000,
          resolve,
          cleanup,
          signal,
        };
        signal.addEventListener('abort', abort, { once: true });
        current.queue.push(waiter);
        this.drain(current);
      },
    );
  }

  /** 仅向 FIFO 队首发放开始顺序；HTTP 响应等待不在此处进行。
   * @param starts 当前 storage 的开始记录。
   * @returns 不适用。
   * @throws 不适用。
   */
  private drain(starts: Starts): void {
    if (starts.timer) clearTimeout(starts.timer);
    starts.timer = undefined;
    if (this.shutdown.signal.aborted || starts.active) return;
    const waiter = starts.queue[0];
    if (!waiter) return;
    const remaining =
      starts.lastStart === undefined
        ? 0
        : starts.lastStart + waiter.intervalMs - performance.now();
    if (remaining > 0) {
      starts.timer = setTimeout(
        this.drain.bind(this, starts),
        remaining,
      ).unref();
      return;
    }
    starts.queue.shift();
    waiter.cleanup();
    starts.active = true;
    let finished = false;
    waiter.resolve(
      /** 提交实际开始或撤销派发顺序，然后唤醒下一项。
       * @param started 是否马上开始 HTTP 请求。
       * @returns 不适用。
       * @throws Error 提交前取消；调用方仍须在 finally 中撤销。
       */
      (started) => {
        if (finished) return;
        if (started) waiter.signal.throwIfAborted();
        finished = true;
        if (started) starts.lastStart = performance.now();
        starts.active = false;
        this.drain(starts);
      },
    );
  }

  /** 中止全部排队等待并解除计时器；已派发 HTTP 由传输层收尾。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  onModuleDestroy(): void {
    this.shutdown.abort();
    for (const starts of this.starts.values())
      if (starts.timer) clearTimeout(starts.timer);
    this.starts.clear();
  }
}
