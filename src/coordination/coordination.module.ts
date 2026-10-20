// 协调叶子模块持有就绪标志与每实例 API 配额。
import { ApiQuota } from './api-quota.service.js';
import { RunQueue } from './run-queue.js';
import { Injectable, Module } from '@nestjs/common';

/** 当前进程的就绪状态。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class Readiness {
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
  providers: [Readiness, ApiQuota, RunQueue],
  exports: [Readiness, ApiQuota, RunQueue],
})
export class CoordinationModule {}
