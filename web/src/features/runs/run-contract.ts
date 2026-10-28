// 定义并校验运行相关公开响应，保持与后端字段边界一致。
import { ApiError, isRecord } from '../../lib/api-client';
import { parseJob, parseTarget } from '../jobs/job-contract';
import type { JobView, Target } from '../jobs/job-contract';
import type { Page } from '../../lib/parsers';
import {
  parsePage,
  expectString,
  expectNumber,
  expectBoolean,
  nullableString,
  nullableNumber,
  expectEnum,
  expectRecord,
  stringArray,
  parseStats,
  parseDiagnostic,
} from '../../lib/parsers';

/** Run 生命周期状态。 */
export const RUN_STATUSES = [
  'queued',
  'scanning',
  'planned',
  'executing',
  'cancelling',
  'recovering',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
  'interrupted',
] as const;

/** 活动（非终态）Run 状态。 */
export const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'scanning',
  'planned',
  'executing',
  'cancelling',
  'recovering',
]);

/** Run 状态类型。 */
export type RunStatus = (typeof RUN_STATUSES)[number];

/** 结构化错误。 */
export interface ErrorInfo {
  /** 错误码。 */
  code: string;
  /** 可展示的错误消息。 */
  message: string;
}

/** 运行聚合统计。 */
export interface RunStats {
  [key: string]: number;
}

/** Run 列表视图。 */
export interface RunView {
  /** Run UUID。 */
  id: string;
  /** 所属 Job UUID。 */
  jobId: string;
  /** 触发方式；重试运行同样为 manual，以 retryOfRunId 区分。 */
  trigger: 'manual' | 'cron';
  /** 重试来源运行 ID；非空表示只重试来源运行中未成功的项目。 */
  retryOfRunId: string | null;
  /** 来源运行是否仍在历史中；被保留期清理后为 false，普通运行恒为 false。 */
  retrySourceExists: boolean;
  /** 调度时间。 */
  scheduledAt: string | null;
  /** 是否仅预览。 */
  dryRun: boolean;
  /** 是否确认删除。 */
  confirmDeletes: boolean;
  /** 当前状态。 */
  status: RunStatus;
  /** 聚合统计。 */
  stats: RunStats;
  /** 停止原因。 */
  stopReason: string | null;
  /** 结构化错误。 */
  error: ErrorInfo | null;
  /** 创建时间。 */
  createdAt: string;
  /** 更新时间。 */
  updatedAt: string;
  /** 开始时间。 */
  startedAt: string | null;
  /** 扫描完成时间。 */
  scanCompletedAt: string | null;
  /** 结束时间。 */
  endedAt: string | null;
  /** 截止时间。 */
  deadlineAt: string | null;
  /** 排队截止时间。 */
  queueDeadlineAt: string;
  /** 取消请求时间。 */
  cancelRequestedAt: string | null;
  /** 恢复截止时间。 */
  recoveryDeadlineAt: string | null;
}

/** Run 目标摘要。 */
export interface RunTargetView {
  /** Run Target UUID。 */
  id: string;
  /** 关联的 Target UUID。 */
  targetId: string;
  /** 目标实例名称：快照名，其次当前名，最后为实例 ID 前 8 位。 */
  instanceName: string;
  /** 快照配置。 */
  config: {
    target: Target;
    instance: Record<string, unknown>;
  };
  /** 目标统计。 */
  stats: RunStats;
  /** 源扫描完成。 */
  sourceComplete: boolean;
  /** 目标扫描完成。 */
  targetComplete: boolean;
  /** 目标有嫌疑。 */
  suspect: boolean;
  /** 删除被阻断。 */
  deleteBlocked: boolean;
  /** extras 被阻断。 */
  extrasBlocked: boolean;
  /** 阻断原因码。 */
  blockReasons: string[];
  /** 观测到的目标文件数。 */
  observedTargetFileCount: number;
  /** 计划替换数。 */
  plannedReplaceCount: number;
  /** 计划 extras 数。 */
  plannedExtraCount: number;
  /** 删除预算。 */
  deleteBudgetCount: number | null;
}

/** 不能重试的原因码，与后端 retryEligibility.reason 一致。 */
export const RETRY_REASONS = [
  'RUN_NOT_TERMINAL',
  'DRY_RUN',
  'HISTORY_EXPIRED',
  'JOB_ARCHIVED',
  'JOB_BUSY',
  'RUN_SUPERSEDED',
  'SOURCE_ENDPOINT_CHANGED',
  'NO_RETRY_ITEMS',
] as const;

/** 不能重试的原因码类型。 */
export type RetryReason = (typeof RETRY_REASONS)[number];

/** 能否“重试未成功项”及将重新检查的数量；数量不是将执行的操作数。 */
export interface RetryEligibility {
  /** 当前是否可以重试；提交时后端会再次检查。 */
  eligible: boolean;
  /** 不可重试的原因；可重试时为 null。 */
  reason: RetryReason | null;
  /** 将重新检查的文件数。 */
  candidateFiles: number;
  /** 将重新检查的目录数（仅目录自身，不含其中内容）。 */
  candidateDirectories: number;
  /** 因所属目标已移除或改了实例/路径而不参与的项目数。 */
  excludedItems: number;
}

/** Run 详情（含配置快照和目标）。 */
export interface RunDetail extends RunView {
  /** 重试资格与候选数量。 */
  retryEligibility: RetryEligibility;
  /** 源实例名称，解析规则同目标实例名称。 */
  sourceInstanceName: string;
  /** 固定配置快照。 */
  config: {
    snapshotVersion: 1;
    job: JobView;
    instances: Record<string, Record<string, unknown>>;
    settings: Record<string, unknown>;
  };
  /** 按目标汇总。 */
  targets: RunTargetView[];
  /** 扫描问题数。 */
  issueCount: number;
}

/** 扫描问题。 */
export interface IssueView {
  /** 问题 UUID。 */
  id: string;
  /** 所属 Run UUID。 */
  runId: string;
  /** 关联目标 UUID。 */
  runTargetId: string | null;
  /** 端点角色。 */
  endpointRole: 'source' | 'target';
  /** 关联实例 UUID。 */
  instanceId: string;
  /** 路径。 */
  path: string;
  /** 问题码。 */
  code: string;
  /** 可展示消息。 */
  message: string;
  /** 是否保护子树。 */
  protectSubtree: boolean;
  /** 创建时间。 */
  createdAt: string;
}

/** 解析 RunView 基础字段。
 * @param value 未信任的 JSON。
 * @returns 类型安全的 RunView。
 * @throws ApiError 响应不符合契约。
 */
export function parseRunView(value: unknown): RunView {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.status !== 'string'
  )
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid run.');
  return {
    id: value.id,
    jobId: expectString(value.jobId, 'jobId'),
    trigger: expectEnum(value.trigger, ['manual', 'cron'], 'trigger'),
    retryOfRunId: nullableString(value.retryOfRunId, 'retryOfRunId'),
    retrySourceExists: expectBoolean(
      value.retrySourceExists,
      'retrySourceExists',
    ),
    scheduledAt: nullableString(value.scheduledAt, 'scheduledAt'),
    dryRun: expectBoolean(value.dryRun, 'dryRun'),
    confirmDeletes: expectBoolean(value.confirmDeletes, 'confirmDeletes'),
    status: expectEnum(value.status, RUN_STATUSES, 'status'),
    stats: parseStats(value.stats),
    stopReason: nullableString(value.stopReason, 'stopReason'),
    error: parseDiagnostic(value.error),
    createdAt: expectString(value.createdAt, 'createdAt'),
    updatedAt: expectString(value.updatedAt, 'updatedAt'),
    startedAt: nullableString(value.startedAt, 'startedAt'),
    scanCompletedAt: nullableString(value.scanCompletedAt, 'scanCompletedAt'),
    endedAt: nullableString(value.endedAt, 'endedAt'),
    deadlineAt: nullableString(value.deadlineAt, 'deadlineAt'),
    queueDeadlineAt: expectString(value.queueDeadlineAt, 'queueDeadlineAt'),
    cancelRequestedAt: nullableString(
      value.cancelRequestedAt,
      'cancelRequestedAt',
    ),
    recoveryDeadlineAt: nullableString(
      value.recoveryDeadlineAt,
      'recoveryDeadlineAt',
    ),
  };
}

/** 解析 RunTargetView。
 * @param value 未信任的 JSON。
 * @param index 目标在响应中的序号。
 * @returns 类型安全的 RunTargetView。
 * @throws ApiError 响应不符合契约。
 */
function parseRunTarget(value: unknown, index: number): RunTargetView {
  if (!isRecord(value) || typeof value.id !== 'string')
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid run target.');
  return {
    id: value.id,
    targetId: expectString(value.targetId, 'targetId'),
    instanceName: expectString(value.instanceName, 'instanceName'),
    config: {
      target: parseTarget(expectRecord(value.config, 'config').target, index),
      instance: expectRecord(
        expectRecord(value.config, 'config').instance,
        'instance',
      ),
    },
    stats: parseStats(value.stats),
    sourceComplete: expectBoolean(value.sourceComplete, 'sourceComplete'),
    targetComplete: expectBoolean(value.targetComplete, 'targetComplete'),
    suspect: expectBoolean(value.suspect, 'suspect'),
    deleteBlocked: expectBoolean(value.deleteBlocked, 'deleteBlocked'),
    extrasBlocked: expectBoolean(value.extrasBlocked, 'extrasBlocked'),
    blockReasons: stringArray(value.blockReasons, 'blockReasons'),
    observedTargetFileCount: expectNumber(
      value.observedTargetFileCount,
      'observedTargetFileCount',
    ),
    plannedReplaceCount: expectNumber(
      value.plannedReplaceCount,
      'plannedReplaceCount',
    ),
    plannedExtraCount: expectNumber(
      value.plannedExtraCount,
      'plannedExtraCount',
    ),
    deleteBudgetCount: nullableNumber(
      value.deleteBudgetCount,
      'deleteBudgetCount',
    ),
  };
}

/** 解析 RunDetail。
 * @param value 未信任的 JSON。
 * @returns 完整 RunDetail。
 * @throws ApiError 响应不符合契约。
 */
export function parseRunDetail(value: unknown): RunDetail {
  const base = parseRunView(value);
  if (!isRecord(value))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid run detail.');
  const retry = expectRecord(value.retryEligibility, 'retryEligibility');
  return {
    ...base,
    retryEligibility: {
      eligible: expectBoolean(retry.eligible, 'retryEligibility.eligible'),
      reason:
        retry.reason === null
          ? null
          : expectEnum(retry.reason, RETRY_REASONS, 'retryEligibility.reason'),
      candidateFiles: expectNumber(
        retry.candidateFiles,
        'retryEligibility.candidateFiles',
      ),
      candidateDirectories: expectNumber(
        retry.candidateDirectories,
        'retryEligibility.candidateDirectories',
      ),
      excludedItems: expectNumber(
        retry.excludedItems,
        'retryEligibility.excludedItems',
      ),
    },
    sourceInstanceName: expectString(
      value.sourceInstanceName,
      'sourceInstanceName',
    ),
    config: parseConfig(value.config),
    targets: parseTargets(value.targets),
    issueCount: expectNumber(value.issueCount, 'issueCount'),
  };
}

/** 解析 IssueView。
 * @param value 未信任的 JSON。
 * @returns 类型安全的 IssueView。
 * @throws ApiError 响应不符合契约。
 */
export function parseIssue(value: unknown): IssueView {
  if (!isRecord(value) || typeof value.id !== 'string')
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid issue.');
  return {
    id: value.id,
    runId: expectString(value.runId, 'runId'),
    runTargetId: nullableString(value.runTargetId, 'runTargetId'),
    endpointRole: expectEnum(
      value.endpointRole,
      ['source', 'target'],
      'endpointRole',
    ),
    instanceId: expectString(value.instanceId, 'instanceId'),
    path: expectString(value.path, 'path'),
    code: expectString(value.code, 'code'),
    message: expectString(value.message, 'message'),
    protectSubtree: expectBoolean(value.protectSubtree, 'protectSubtree'),
    createdAt: expectString(value.createdAt, 'createdAt'),
  };
}

/** 解析 Run 分页。
 * @param value 未信任的 JSON。
 * @returns 类型安全的分页结果。
 * @throws ApiError 响应不符合分页契约。
 */
export function parseRunPage(value: unknown): Page<RunView> {
  return parsePage(value, parseRunView, 'run');
}

/** 解析 Issue 分页。
 * @param value 未信任的 JSON。
 * @returns 类型安全的分页结果。
 * @throws ApiError 响应不符合分页契约。
 */
export function parseIssuePage(value: unknown): Page<IssueView> {
  return parsePage(value, parseIssue, 'issue');
}

/** 校验运行快照的对象边界，保留历史配置原值。
 * @param value 后端快照。
 * @returns 已验证对象结构的快照。
 * @throws ApiError 快照缺失或结构不合法。
 */
function parseConfig(value: unknown): RunDetail['config'] {
  const config = expectRecord(value, 'config');
  if (config.snapshotVersion !== 1)
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid snapshotVersion.');
  return {
    snapshotVersion: 1,
    job: parseJob(config.job),
    settings: expectRecord(config.settings, 'settings'),
    instances: Object.fromEntries(
      Object.entries(expectRecord(config.instances, 'instances')).map(
        ([id, instance]) => [id, expectRecord(instance, 'instance')],
      ),
    ),
  };
}
/** 校验目标集合，缺失目标不伪装成空列表。
 * @param value 后端目标数组。
 * @returns 目标视图。
 * @throws ApiError 不是数组或目标结构错误。
 */
function parseTargets(value: unknown): RunTargetView[] {
  if (!Array.isArray(value))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid run targets.');
  return value.map(parseRunTarget);
}

/** 运行列表项：RunView 加接受运行时冻结的任务名；活动运行的统计为实时值。 */
export interface RunListItem extends RunView {
  /** 运行快照中的任务名，不随任务改名或归档变化。 */
  jobName: string;
}

/** 解析运行列表项。
 * @param value 未信任的 JSON。
 * @returns 运行列表项。
 * @throws ApiError 契约不符。
 */
export function parseRunListItem(value: unknown): RunListItem {
  const run = parseRunView(value);
  return {
    ...run,
    jobName: expectString(expectRecord(value, 'run').jobName, 'jobName'),
  };
}

/** 解析运行列表分页。
 * @param value 未信任的 JSON。
 * @returns 运行列表项分页。
 * @throws ApiError 契约不符。
 */
export function parseRunListPage(value: unknown): Page<RunListItem> {
  return parsePage(value, parseRunListItem, 'run');
}
