// 校验公开健康检查响应；503 时后端仍返回同一形状，用于显示服务未就绪。
import { ApiError, isRecord } from '../../lib/api-client';
import { expectEnum } from '../../lib/parsers';

/** 就绪检查结果。 */
export interface HealthView {
  /** 系统状态。 */
  status: 'ok' | 'not_ready';
  /** 数据库状态。 */
  database: 'ok' | 'error';
}

/** 解析就绪检查响应。
 * @param value 未信任 JSON。
 * @returns 健康视图。
 * @throws ApiError 契约不符。
 */
export function parseHealth(value: unknown): HealthView {
  if (
    !isRecord(value) ||
    typeof value.status !== 'string' ||
    typeof value.database !== 'string'
  )
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid health response.');
  return {
    status: expectEnum(value.status, ['ok', 'not_ready'], 'status'),
    database: expectEnum(value.database, ['ok', 'error'], 'database'),
  };
}
