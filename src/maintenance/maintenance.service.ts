// 在就绪后调度小时远程维护及UTC每日历史清理，两个任务串行且不补跑。
import { Inject, Injectable } from '@nestjs/common';
import type {
  OnModuleInit,
  OnModuleDestroy,
  BeforeApplicationShutdown,
} from '@nestjs/common';
import { CronJob } from 'cron';
import { Readiness } from '../coordination/readiness.js';
import { FatalError } from '../coordination/fatal-error.js';
import { RemoteTaskMaintenance } from './remote-tasks.js';
import { HistoryRetention } from './history-retention.js';

/** 单进程维护runner，不创建远程文件动作。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class MaintenanceService
  implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown
{
  private timer?: ReturnType<typeof setTimeout>;
  private daily?: CronJob;
  private dailyDelivering = false;
  private detach?: () => void;
  private running?: Promise<void>;
  private readonly pending = new Set<'remote' | 'history'>();
  /** 保存具体维护任务和生命周期。
   * @param readiness 恢复及关闭闸门。
   * @param fatal 持久化失败出口。
   * @param remote task维护。
   * @param history 本地保留。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(Readiness) private readonly readiness: Readiness,
    @Inject(FatalError) private readonly fatal: FatalError,
    @Inject(RemoteTaskMaintenance)
    private readonly remote: RemoteTaskMaintenance,
    @Inject(HistoryRetention) private readonly history: HistoryRetention,
  ) {}
  /** 等待真实就绪并订阅最早关闭广播。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  onModuleInit(): void {
    this.detach = this.readiness.whenReady(this.start.bind(this));
    this.readiness.shutdown.signal.addEventListener('abort', this.stop, {
      once: true,
    });
  }
  /** 只安排未来时刻，启动不执行历史清理。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 固定timer创建失败。
   */
  private start(): void {
    this.timer = setTimeout(this.hourly, 30000);
    this.daily = CronJob.from({
      cronTime: '0 3 * * *',
      timeZone: 'UTC',
      start: true,
      onTick: this.dailyTick.bind(this),
      errorHandler: this.fatal.fail.bind(this.fatal),
    });
  }
  /** 一次远程周期进入串行队列，然后安排一小时后。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  private readonly hourly = (): void => {
    if (this.readiness.stopping) return;
    this.request('remote');
    this.timer = setTimeout(this.hourly, 3600000);
  };
  /** 合并同一次timer的重复回调，历史不在小时周期执行。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  private dailyTick(): void {
    if (this.dailyDelivering) return;
    this.dailyDelivering = true;
    queueMicrotask(
      /** 下一次timer可再次安排历史工作，不合并不同周期。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      () => {
        this.dailyDelivering = false;
      },
    );
    this.request('history');
  }
  /** 当前工作退出后才执行另一维护任务；重复待执行项合并。
   * @param kind 具体维护任务。
   * @returns 不适用。
   * @throws 不适用；后台失败转fatal。
   */
  request(kind: 'remote' | 'history'): void {
    if (!this.readiness.ready || this.readiness.stopping) return;
    this.pending.add(kind);
    if (this.running) return;
    this.running = this.drain()
      .catch(this.fatal.fail.bind(this.fatal))
      .finally(
        /** 当前队列已排空后释放runner。
         * @param 不适用。
         * @returns 不适用。
         * @throws 不适用。
         */
        () => {
          this.running = undefined;
          const next = this.pending.values().next().value;
          if (next !== undefined && !this.readiness.stopping)
            this.request(next);
        },
      );
  }
  /** 顺序执行具体周期，中间从不重叠网络和历史清理任务。
   * @param 不适用。
   * @returns 全部待执行周期结束。
   * @throws Error 维护任务失败。
   */
  private async drain(): Promise<void> {
    while (this.pending.size && !this.readiness.stopping) {
      const kind = this.pending.values().next().value;
      if (kind === undefined) return;
      this.pending.delete(kind);
      if (kind === 'remote') await this.remote.cycle();
      else await this.history.cycle();
    }
  }
  /** 停止未来timer及待执行周期，正在运行工作通过共享signal退出。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  private readonly stop = (): void => {
    if (this.timer) clearTimeout(this.timer);
    this.daily?.stop();
    this.pending.clear();
  };
  /** 关闭最早阶段撤销就绪。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  onModuleDestroy(): void {
    this.readiness.beginShutdown();
    this.stop();
    this.detach?.();
  }
  /** 数据库关闭前等待正在处理的本地维护退出。
   * @param 不适用。
   * @returns 维护退出。
   * @throws 不适用；失败已由fatal处理。
   */
  async beforeApplicationShutdown(): Promise<void> {
    await this.running;
  }
}
