// 在同一个初始化钩子中顺序验证密钥和初始化管理员。
import { Inject, Module } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { KeysService } from './keys.service.js';
import { AuthService } from './auth.service.js';
import { LoginLimiter } from './login-limiter.js';
import { AuthGuard } from './auth.guard.js';
import { AuthController } from './auth.controller.js';

/** 安全模块，依赖数据库迁移完成。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [ConfigurationModule, DatabaseModule, JwtModule.register({})],
  providers: [
    KeysService,
    AuthService,
    LoginLimiter,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  controllers: [AuthController],
  exports: [KeysService, AuthService],
})
export class SecurityModule implements OnModuleInit {
  /** 保存需顺序初始化的服务。
   * @param keys 密钥服务。
   * @param auth 管理员服务。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(KeysService) private readonly keys: KeysService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** 密文验证失败时不进入管理员初始化。
   * @param 不适用。
   * @returns 初始化完成的 Promise。
   * @throws Error 密钥或管理员初始化失败。
   */
  async onModuleInit(): Promise<void> {
    await this.keys.initialize();
    await this.auth.bootstrap();
  }
}
