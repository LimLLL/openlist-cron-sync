// 协调叶子模块持有就绪标志与每实例 API 配额。
import { ApiQuota } from './api-quota.service.js';
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
}

/** 没有反向依赖的协调叶子模块。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({ providers: [Readiness, ApiQuota], exports: [Readiness, ApiQuota] })
export class CoordinationModule {}
