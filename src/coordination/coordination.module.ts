// 协调叶子模块持有就绪标志与每实例 API 配额。
import { DatabaseModule } from '../database/database.module.js';
import { Quarantine } from './quarantine.js';
import { PathOccupancy } from './path-occupancy.js';
import { RelayResources } from './relay-resources.js';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { ApiQuota } from './api-quota.service.js';
import { RunQueue } from './run-queue.js';
import { AppConfig } from '../configuration/app-config.js';
import { Inject, Injectable, Module } from '@nestjs/common';

/** 当前进程的就绪状态。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class Readiness {
  /** 关闭开始后给控制请求独立的剩余宽限。 */
  cleanupSignal?: AbortSignal;
  /** 读取进程关闭宽限。
   * @param config 进程配置。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(@Inject(AppConfig) private readonly config: AppConfig) {}
  /** 仅在初始化和监听成功后为 true，关闭开始时恢复 false。 */
  ready = false;
  /** Run 启动恢复已完成。 */
  recovered = false;
  /** 关闭开始后禁止扫描错误路径写 Run 终态。 */
  stopping = false;
  /** 任一关闭钩子开始时立即广播，避免钩子顺序留下终态写入窗口。 */
  readonly shutdown = new AbortController();

  /** 原子撤销就绪并中止本地工作，允许多个关闭钩子重复调用。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  beginShutdown(): void {
    this.cleanupSignal ??= AbortSignal.timeout(
      this.config.shutdownGraceSeconds * 1000,
    );
    this.stopping = true;
    this.ready = false;
    this.shutdown.abort();
  }
}

/** 没有反向依赖的协调叶子模块。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [ConfigurationModule, DatabaseModule],
  providers: [
    Readiness,
    ApiQuota,
    RunQueue,
    PathOccupancy,
    RelayResources,
    Quarantine,
  ],
  exports: [
    Readiness,
    ApiQuota,
    RunQueue,
    PathOccupancy,
    RelayResources,
    Quarantine,
  ],
})
export class CoordinationModule {}
