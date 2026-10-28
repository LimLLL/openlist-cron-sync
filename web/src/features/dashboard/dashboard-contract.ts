// 面板仅解析展示所需的最小字段集，避免与其他 feature 产生耦合。
import { ApiError, isRecord } from '../../lib/api-client';
import {
  parsePage,
  expectString,
  expectBoolean,
  expectEnum,
  expectRecord,
  nullableString,
  parseStats,
  parseDiagnostic,
  stringArray,
} from '../../lib/parsers';
import type { Page } from '../../lib/parsers';

/** 面板所需的 Run 摘要。 */
export interface DashboardRun {
  /** Run UUID。 */
  id: string;
  /** 所属 Job UUID。 */
  jobId: string;
  /** 触发方式。 */
  trigger: 'manual' | 'cron';
  /** 是否预览。 */
  dryRun: boolean;
  /** 生命周期状态。 */
  status: string;
  /** 聚合统计（键取决于后端版本，不枚举）。 */
  stats: Record<string, number>;
  /** 错误摘要或 null。 */
  error: { code: string; message: string } | null;
  /** 创建时间 ISO。 */
  createdAt: string;
  /** 最近更新 ISO，用于合并不同状态查询间的同一个 Run。 */
  updatedAt: string;
  /** 开始时间 ISO 或 null。 */
  startedAt: string | null;
  /** 结束时间 ISO 或 null。 */
  endedAt: string | null;
}

/** 面板所需的 Instance 摘要。 */
export interface DashboardInstance {
  /** Instance UUID。 */
  id: string;
  /** 展示名。 */
  name: string;
  /** 认证状态。 */
  authState: 'untested' | 'ready' | 'auth_blocked';
  /** 最近错误或 null。 */
  lastError: { code: string; message: string } | null;
  /** 最近测试 ISO 或 null。 */
  lastTestAt: string | null;
}

/** 面板所需的 Job 摘要。 */
export interface DashboardJob {
  /** Job UUID。 */
  id: string;
  /** 展示名。 */
  name: string;
  /** 是否启用 cron。 */
  enabled: boolean;
  /** cron 表达式或 null。 */
  cron: string | null;
  /** 时区。 */
  timezone: string;
  /** 源 Instance UUID。 */
  sourceInstanceId: string;
  /** 目标 Instance UUID 列表。 */
  targetInstanceIds: string[];
}

/** 下次执行时刻。 */
export interface NextFireTimes {
  /** 时区。 */
  timezone: string;
  /** ISO 时间列表。 */
  times: string[];
}

/** 健康状态。 */
export interface HealthView {
  /** 系统状态。 */
  status: 'ok' | 'not_ready';
  /** 数据库状态。 */
  database: 'ok' | 'error';
}

/** 解析 Run 摘要。
 * @param value 未信任 JSON。
 * @returns 面板用 Run。
 * @throws ApiError 契约不符。
 */
export function parseDashboardRun(value: unknown): DashboardRun {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.status !== 'string'
  )
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid run.');
  const error = parseDiagnostic(value.error);
  return {
    id: value.id,
    jobId: expectString(value.jobId, 'jobId'),
    trigger: expectEnum(value.trigger, ['manual', 'cron'], 'trigger'),
    dryRun: expectBoolean(value.dryRun, 'dryRun'),
    status: value.status,
    stats: parseStats(value.stats),
    error,
    createdAt: expectString(value.createdAt, 'createdAt'),
    updatedAt: expectString(value.updatedAt, 'updatedAt'),
    startedAt: nullableString(value.startedAt, 'startedAt'),
    endedAt: nullableString(value.endedAt, 'endedAt'),
  };
}

/** 解析 Run 分页。
 * @param value 未信任 JSON。
 * @returns 分页 Run 列表。
 * @throws ApiError 契约不符。
 */
export function parseDashboardRunPage(value: unknown): Page<DashboardRun> {
  return parsePage(value, parseDashboardRun, 'run');
}

/** 解析 Instance 摘要。
 * @param value 未信任 JSON。
 * @returns 面板用 Instance。
 * @throws ApiError 契约不符。
 */
export function parseDashboardInstance(value: unknown): DashboardInstance {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string'
  )
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid instance.');
  const lastError = parseDiagnostic(value.lastError);
  return {
    id: value.id,
    name: value.name,
    authState: expectEnum(
      value.authState,
      ['untested', 'ready', 'auth_blocked'],
      'authState',
    ),
    lastError,
    lastTestAt: nullableString(value.lastTestAt, 'lastTestAt'),
  };
}

/** 解析 Instance 分页。
 * @param value 未信任 JSON。
 * @returns 分页 Instance 列表。
 * @throws ApiError 契约不符。
 */
export function parseDashboardInstancePage(
  value: unknown,
): Page<DashboardInstance> {
  return parsePage(value, parseDashboardInstance, 'instance');
}

/** 解析 Job 摘要。
 * @param value 未信任 JSON。
 * @returns 面板用 Job。
 * @throws ApiError 契约不符。
 */
export function parseDashboardJob(value: unknown): DashboardJob {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string'
  )
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid job.');
  const source = expectRecord(value.source, 'source');
  if (!Array.isArray(value.targets))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid job targets.');
  const targets = value.targets;
  return {
    id: value.id,
    name: value.name,
    enabled: expectBoolean(value.enabled, 'enabled'),
    cron: nullableString(value.cron, 'cron'),
    timezone: expectString(value.timezone, 'timezone'),
    sourceInstanceId: expectString(source.instanceId, 'source.instanceId'),
    targetInstanceIds: targets.map((target) =>
      expectString(
        expectRecord(target, 'target').instanceId,
        'target.instanceId',
      ),
    ),
  };
}

/** 解析 Job 分页。
 * @param value 未信任 JSON。
 * @returns 分页 Job 列表。
 * @throws ApiError 契约不符。
 */
export function parseDashboardJobPage(value: unknown): Page<DashboardJob> {
  return parsePage(value, parseDashboardJob, 'job');
}

/** 解析下次执行时刻。
 * @param value 未信任 JSON。
 * @returns 时区和时间列表。
 * @throws ApiError 契约不符。
 */
export function parseNextFireTimes(value: unknown): NextFireTimes {
  if (
    !isRecord(value) ||
    typeof value.timezone !== 'string' ||
    !Array.isArray(value.times)
  )
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid next-fire-times.');
  return {
    timezone: value.timezone,
    times: stringArray(value.times, 'times'),
  };
}

/** 解析系统健康。
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
