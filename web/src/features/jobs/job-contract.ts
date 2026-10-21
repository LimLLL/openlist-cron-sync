// 校验 Job API 响应，保持与后端 api-schemas.ts 中定义的公共形状一致。
import { ApiError, isRecord } from '../../lib/api-client';
import {
  parsePage,
  expectString,
  expectNumber,
  expectBoolean,
  stringArray,
} from '../../lib/parsers';
import type { Page } from '../../lib/parsers';

/** 目录端点公共值。 */
export interface Endpoint {
  /** 实例 UUID。 */
  instanceId: string;
  /** 账号内绝对目录。 */
  path: string;
  /** 是否有路径密码。 */
  hasPassword: boolean;
  /** 普通扫描是否刷新。 */
  refresh: boolean;
}

/** 删除阈值。 */
export interface DeleteLimits {
  /** 是否启用数值阈值。 */
  enabled: boolean;
  /** 最大文件数，含边界。 */
  maxCount: number | null;
  /** 最大百分比，整数。 */
  maxPercent: number | null;
}

/** 完整过滤配置。 */
export interface Filters {
  /** 任意匹配即包含，空数组表示全部文件。 */
  include: string[];
  /** 优先排除。 */
  exclude: string[];
  /** 最小字节数。 */
  minSizeBytes: number | null;
  /** 最大字节数。 */
  maxSizeBytes: number | null;
}

/** 稳定标识的目标。 */
export interface Target extends Endpoint {
  /** 稳定 UUID。 */
  id: string;
  /** 当前顺序，从 0 起。 */
  position: number;
  /** 模式。 */
  mode: 'incremental' | 'mirror';
  /** 此目标的文件创建方式。 */
  createMode: 'relay' | 'server_copy';
  /** 删除阈值。 */
  deleteLimits: DeleteLimits;
}

/** Job 完整公共响应。 */
export interface JobView {
  /** UUID。 */
  id: string;
  /** 展示名称。 */
  name: string;
  /** 源目录。 */
  source: Endpoint;
  /** 按 position 排序的目标。 */
  targets: Target[];
  /** cron 启用值。 */
  enabled: boolean;
  /** 五段 cron 或 null。 */
  cron: string | null;
  /** IANA 时区。 */
  timezone: string;
  /** 完整过滤值。 */
  filters: Filters;
  /** 是否允许空源删除。 */
  allowEmptySource: boolean;
  /** 是否同步目录结构。 */
  syncEmptyDirs: boolean;
  /** 此 Job 所有 relay Target 的聚合上传 bytes/s。 */
  relayBandwidthLimit: number;
  /** 超时秒数。 */
  timeoutSeconds: number;
  /** 通知通道。 */
  notificationChannelIds: string[];
  /** 创建 UTC 时间。 */
  createdAt: string;
  /** 更新 UTC 时间。 */
  updatedAt: string;
  /** 归档 UTC 时间。 */
  archivedAt: string | null;
}

/** 下次触发时间响应。 */
export interface NextFireTimes {
  /** Job 时区。 */
  timezone: string;
  /** UTC ISO 时间列表。 */
  times: string[];
}

/** 触发运行的最小响应。 */
export interface TriggerResult {
  /** 新 Run UUID。 */
  id: string;
  /** 关联 Job UUID。 */
  jobId: string;
  /** 是否预览。 */
  dryRun: boolean;
  /** 初始状态。 */
  status: string;
}

/** 校验删除阈值。
 * @param value 未信任 JSON。
 * @returns DeleteLimits。
 * @throws ApiError 结构不匹配。
 */
function parseDeleteLimits(value: unknown): DeleteLimits {
  if (!isRecord(value))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid delete limits.');
  return {
    enabled: expectBoolean(value.enabled, 'deleteLimits.enabled'),
    maxCount:
      value.maxCount === null
        ? null
        : expectNumber(value.maxCount, 'deleteLimits.maxCount'),
    maxPercent:
      value.maxPercent === null
        ? null
        : expectNumber(value.maxPercent, 'deleteLimits.maxPercent'),
  };
}

/** 校验过滤配置。
 * @param value 未信任 JSON。
 * @returns Filters。
 * @throws ApiError 结构不匹配。
 */
function parseFilters(value: unknown): Filters {
  if (!isRecord(value))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid filters.');
  return {
    include: stringArray(value.include, 'filters.include'),
    exclude: stringArray(value.exclude, 'filters.exclude'),
    minSizeBytes:
      value.minSizeBytes === null || value.minSizeBytes === undefined
        ? null
        : expectNumber(value.minSizeBytes, 'filters.minSizeBytes'),
    maxSizeBytes:
      value.maxSizeBytes === null || value.maxSizeBytes === undefined
        ? null
        : expectNumber(value.maxSizeBytes, 'filters.maxSizeBytes'),
  };
}

/** 校验端点。
 * @param value 未信任 JSON。
 * @param label 错误上下文。
 * @returns Endpoint。
 * @throws ApiError 结构不匹配。
 */
function parseEndpoint(value: unknown, label: string): Endpoint {
  if (!isRecord(value))
    throw new ApiError(0, 'INVALID_RESPONSE', `Invalid ${label}.`);
  return {
    instanceId: expectString(value.instanceId, `${label}.instanceId`),
    path: expectString(value.path, `${label}.path`),
    hasPassword: expectBoolean(value.hasPassword, `${label}.hasPassword`),
    refresh: expectBoolean(value.refresh, `${label}.refresh`),
  };
}

/** 校验目标。
 * @param value 未信任 JSON。
 * @param index 序号。
 * @returns Target。
 * @throws ApiError 结构不匹配。
 */
export function parseTarget(value: unknown, index: number): Target {
  const endpoint = parseEndpoint(value, `targets[${index}]`);
  if (!isRecord(value))
    throw new ApiError(0, 'INVALID_RESPONSE', `Invalid target ${index}.`);
  const mode = value.mode;
  const createMode = value.createMode;
  if (createMode !== 'relay' && createMode !== 'server_copy')
    throw new ApiError(
      0,
      'INVALID_RESPONSE',
      `Invalid target createMode at ${index}.`,
    );
  if (mode !== 'incremental' && mode !== 'mirror')
    throw new ApiError(
      0,
      'INVALID_RESPONSE',
      `Invalid target mode at ${index}.`,
    );
  return {
    ...endpoint,
    id: expectString(value.id, `targets[${index}].id`),
    position: expectNumber(value.position, `targets[${index}].position`),
    mode,
    createMode,
    deleteLimits: parseDeleteLimits(value.deleteLimits),
  };
}

/** 校验 Job 完整响应。
 * @param value 未信任 JSON。
 * @returns JobView。
 * @throws ApiError 结构不匹配。
 */
export function parseJob(value: unknown): JobView {
  if (!isRecord(value))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid job.');
  if (!Array.isArray(value.targets))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid job targets.');
  return {
    id: expectString(value.id, 'id'),
    name: expectString(value.name, 'name'),
    source: parseEndpoint(value.source, 'source'),
    targets: value.targets.map((t: unknown, i: number) => parseTarget(t, i)),
    enabled: expectBoolean(value.enabled, 'enabled'),
    cron: value.cron === null ? null : expectString(value.cron, 'cron'),
    timezone: expectString(value.timezone, 'timezone'),
    filters: parseFilters(value.filters),
    allowEmptySource: expectBoolean(value.allowEmptySource, 'allowEmptySource'),
    syncEmptyDirs: expectBoolean(value.syncEmptyDirs, 'syncEmptyDirs'),
    relayBandwidthLimit: expectNumber(
      value.relayBandwidthLimit,
      'relayBandwidthLimit',
    ),
    timeoutSeconds: expectNumber(value.timeoutSeconds, 'timeoutSeconds'),
    notificationChannelIds: Array.isArray(value.notificationChannelIds)
      ? value.notificationChannelIds.filter(
          (v): v is string => typeof v === 'string',
        )
      : [],
    createdAt: expectString(value.createdAt, 'createdAt'),
    updatedAt: expectString(value.updatedAt, 'updatedAt'),
    archivedAt:
      value.archivedAt === null
        ? null
        : expectString(value.archivedAt, 'archivedAt'),
  };
}

/** 校验 Job 分页。
 * @param value 未信任 JSON。
 * @returns Page<JobView>。
 * @throws ApiError 结构不匹配。
 */
export function parseJobPage(value: unknown): Page<JobView> {
  return parsePage(value, parseJob, 'job');
}

/** 校验下次触发时间。
 * @param value 未信任 JSON。
 * @returns NextFireTimes。
 * @throws ApiError 结构不匹配。
 */
export function parseNextFireTimes(value: unknown): NextFireTimes {
  if (
    !isRecord(value) ||
    typeof value.timezone !== 'string' ||
    !Array.isArray(value.times)
  )
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid next fire times.');
  return {
    timezone: value.timezone,
    times: stringArray(value.times, 'times'),
  };
}

/** 校验触发结果的最小字段。
 * @param value 未信任 JSON。
 * @returns TriggerResult。
 * @throws ApiError 结构不匹配。
 */
export function parseTriggerResult(value: unknown): TriggerResult {
  if (!isRecord(value))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid trigger result.');
  return {
    id: expectString(value.id, 'id'),
    jobId: expectString(value.jobId, 'jobId'),
    dryRun: expectBoolean(value.dryRun, 'dryRun'),
    status: expectString(value.status, 'status'),
  };
}
