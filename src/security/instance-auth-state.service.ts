// 为所有 OpenList 调用方持久化认证阻断与账号身份。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { instances } from '../database/schema.js';
import type { InstanceRecord, InstanceChanges } from '../database/schema.js';
import { ApiError } from '../common/errors.js';

/** 认证身份的持久化入口，不持有 JWT，也不调用 OpenList。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class InstanceAuthState {
  private readonly logger = new Logger(InstanceAuthState.name);
  /** 保存数据库依赖。
   * @param database 已迁移数据库。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /** 读取当前实例，拒绝过期配置发起网络请求。
   * @param expected 调用方配置。
   * @returns 最新认证事实。
   * @throws ApiError 实例归档或连接配置已变更；Error 数据库失败。
   */
  current(expected: InstanceRecord): InstanceRecord {
    const row = this.database.db
      .select()
      .from(instances)
      .where(and(eq(instances.id, expected.id), isNull(instances.archivedAt)))
      .get();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Instance not found');
    if (!sameConnection(row, expected))
      throw new ApiError(409, 'INVALID_STATE', 'Instance connection changed');
    return row;
  }

  /** 保存认证或测试事实，旧响应不能覆盖新凭据。
   * @param expected 请求使用的配置。
   * @param changes 已筛选的状态字段。
   * @returns 不适用。
   * @throws ApiError 请求期间配置变更；Error 数据库失败。
   */
  save(expected: InstanceRecord, changes: InstanceChanges): void {
    this.current(expected);
    this.database.db
      .update(instances)
      .set({ ...changes, updatedAt: Date.now() })
      .where(eq(instances.id, expected.id))
      .run();
  }

  /** 写入持久阻断；冷却期限只在真实登录被限流时设置。
   * @param expected 请求配置。
   * @param reason 固定登录状态原因。
   * @param until 自动冷却结束毫秒；null 表示人工解除。
   * @returns 不适用。
   * @throws ApiError 配置过期；Error 数据库失败。
   */
  block(expected: InstanceRecord, reason: string, until: number | null): void {
    this.save(expected, {
      authState: 'auth_blocked',
      authBlockReason: reason,
      authBlockedUntil: until,
    });
    this.logger.warn('OpenList authentication blocked', {
      instanceId: expected.id,
      decision: reason,
    });
  }
}
/** 比较会改变认证身份的连接配置，不增加指纹或状态版本。
 * @param left 当前配置。
 * @param right 请求配置。
 * @returns 是否仍属于同一连接。
 * @throws 不适用。
 */
export function sameConnection(
  left: InstanceRecord,
  right: InstanceRecord,
): boolean {
  return (
    left.baseUrl === right.baseUrl &&
    left.authMode === right.authMode &&
    left.username === right.username &&
    left.secretEnc === right.secretEnc
  );
}
