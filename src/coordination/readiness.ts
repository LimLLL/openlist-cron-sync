// 维护进程就绪与关闭广播，避免后台模块依赖应用装配顺序。
import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../configuration/app-config.js';

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
  private readonly readyListeners = new Set<() => void>();
  /** 登记就绪回调；初始化完成且HTTP监听后启动后台定时器。
   * @param listener 同步启动回调。
   * @returns 解除登记函数。
   * @throws Error 回调启动失败。
   */
  whenReady(listener: () => void): () => void {
    this.readyListeners.add(listener);
    if (this.ready && !this.stopping) listener();
    return this.readyListeners.delete.bind(this.readyListeners, listener);
  }
  /** 发布初始化及监听完成；不等待远端恢复终态。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 后台工作初始化失败。
   */
  markReady(): void {
    this.ready = this.recovered && !this.stopping;
    if (this.ready) for (const listener of this.readyListeners) listener();
  }
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
