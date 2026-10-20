// 将就绪状态绑定到真实监听与关闭生命周期。
import { Inject, Module } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Server } from 'node:http';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { SecurityModule } from '../security/security.module.js';
import {
  CoordinationModule,
  Readiness,
} from '../coordination/coordination.module.js';
import { SystemController } from './system.controller.js';

/** 系统模块，所有基础初始化完成后才观察监听事件。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [
    ConfigurationModule,
    DatabaseModule,
    SecurityModule,
    CoordinationModule,
  ],
  controllers: [SystemController],
})
export class SystemModule implements OnApplicationBootstrap, OnModuleDestroy {
  private server: Server | undefined;

  /** 保存就绪状态和 HTTP 适配器。
   * @param readiness ready 状态。
   * @param adapter HTTP 适配器。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(Readiness) private readonly readiness: Readiness,
    @Inject(HttpAdapterHost) private readonly adapter: HttpAdapterHost,
  ) {}

  /** 标记成功监听。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  private readonly listening = (): void => {
    this.readiness.ready = this.readiness.recovered && !this.readiness.stopping;
  };

  /** 所有 onModuleInit 成功后安装监听回调。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  onApplicationBootstrap(): void {
    const server: Server = this.adapter.httpAdapter.getHttpServer();
    this.server = server;
    server.once('listening', this.listening);
  }

  /** 先撤销就绪；数据库在 HTTP 关闭后的阶段才释放。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  onModuleDestroy(): void {
    this.readiness.beginShutdown();
    this.server?.off('listening', this.listening);
  }
}
