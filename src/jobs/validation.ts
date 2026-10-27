// 校验 Job 补丁的完整合并值，错误仅包含字段名而不回显输入。
import { randomUUID } from 'node:crypto';
import { validateSchedule } from '../scheduling/cron-time.js';
import { isUUID } from 'class-validator';
import picomatch from 'picomatch';
import { ApiError } from '../common/errors.js';
import { normalizePath } from '../openlist/paths.js';
import type {
  Job,
  PathSecrets,
  Endpoint,
  Target,
  Filters,
  DeleteLimits,
} from './job-types.js';

/** 拒绝非法字段。
 * @param field 字段路径。
 * @param reason 拒绝原因；默认通用说明。
 * @returns 不返回。
 * @throws ApiError 400，不回显值。
 */
export function invalid(field: string, reason = 'Invalid value'): never {
  throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid job configuration', [
    { field, reason },
  ]);
}
/** 验证输入对象及白名单。
 * @param input 未知输入。
 * @param keys 允许字段。
 * @param field 字段路径。
 * @returns 原始对象。
 * @throws ApiError 类型或未知字段错误。
 */
export function objectInput(
  input: unknown,
  keys: readonly string[],
  field: string,
): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    invalid(field);
  for (const key of Object.keys(input)) if (!keys.includes(key)) invalid(field);
  return input as Record<string, unknown>;
}
/** 校验字符串。
 * @param value 输入。
 * @param field 字段路径。
 * @param min 最短字符数。
 * @param max 最长字符数。
 * @returns 字符串原文。
 * @throws ApiError 非法值。
 */
function text(
  value: unknown,
  field: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): string {
  if (
    typeof value !== 'string' ||
    [...value].length < min ||
    [...value].length > max
  )
    invalid(field);
  return value;
}
/** 校验安全整数。
 * @param value 输入。
 * @param field 字段路径。
 * @param min 下界。
 * @param max 上界。
 * @returns 整数。
 * @throws ApiError 非法值。
 */
function number(
  value: unknown,
  field: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    invalid(field);
  return value;
}
/** 校验布尔。
 * @param value 输入。
 * @param field 字段路径。
 * @returns 布尔。
 * @throws ApiError 非法值。
 */
function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') invalid(field);
  return value;
}
/** 校验 UUIDv4。
 * @param value 输入。
 * @param field 字段路径。
 * @returns UUID。
 * @throws ApiError 非法值。
 */
function id(value: unknown, field: string): string {
  const result = text(value, field);
  if (!isUUID(result, '4')) invalid(field);
  return result;
}
/** 合并目录端点和独立密码。
 * @param input 端点补丁。
 * @param previous 旧端点。
 * @param password 旧明文密码，仅在内存使用。
 * @param field 字段路径。
 * @returns 端点及密码。
 * @throws ApiError 验证失败。
 */
function endpoint(
  input: Record<string, unknown>,
  previous: Endpoint | undefined,
  password: string | null,
  field: string,
): { value: Endpoint; password: string | null } {
  const secret =
    input.password === undefined
      ? password
      : input.password === null
        ? null
        : // 空字符串在 OpenList 中等于无密码，必须用 null 清除，避免 hasPassword 误报。
          text(input.password, field + '.password', 1);
  return {
    value: {
      instanceId: id(
        input.instanceId === undefined
          ? previous?.instanceId
          : input.instanceId,
        field + '.instanceId',
      ),
      path: normalizePath(
        text(
          input.path === undefined ? previous?.path : input.path,
          field + '.path',
        ),
      ),
      refresh: bool(
        input.refresh === undefined
          ? (previous?.refresh ?? false)
          : input.refresh,
        field + '.refresh',
      ),
      hasPassword: secret !== null,
    },
    password: secret,
  };
}
/** 合并删除阈值。
 * @param input 可省略补丁。
 * @param previous 旧配置。
 * @returns 完整配置。
 * @throws ApiError 非法阈值。
 */
function limits(input: unknown, previous?: DeleteLimits): DeleteLimits {
  const v =
    input === undefined
      ? {}
      : objectInput(
          input,
          ['enabled', 'maxCount', 'maxPercent'],
          'deleteLimits',
        );
  const base = {
    enabled: true,
    maxCount: 1000,
    maxPercent: 50,
    ...previous,
    ...v,
  };
  const result = {
    enabled: bool(base.enabled, 'deleteLimits.enabled'),
    maxCount:
      base.maxCount === null
        ? null
        : number(base.maxCount, 'deleteLimits.maxCount'),
    maxPercent:
      base.maxPercent === null
        ? null
        : number(base.maxPercent, 'deleteLimits.maxPercent', 0, 100),
  };
  if (result.enabled && result.maxCount === null && result.maxPercent === null)
    invalid('deleteLimits');
  return result;
}
/** 校验 glob 列表，不允许反选规则。
 * @param input 列表。
 * @returns 原始模式列表。
 * @throws ApiError 非法模式。
 */
function globs(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 100) invalid('filters');
  const result: string[] = [];
  for (const item of input) {
    const pattern = text(item, 'filters', 1, 1024);
    if (pattern.startsWith('!')) invalid('filters');
    try {
      picomatch(pattern, { dot: true, nonegate: true });
    } catch {
      invalid('filters');
    }
    result.push(pattern);
  }
  return result;
}
/** 合并过滤规则。
 * @param input 补丁。
 * @param previous 旧规则。
 * @returns 完整规则。
 * @throws ApiError 非法字段。
 */
function filters(input: unknown, previous?: Filters): Filters {
  const patch =
    input === undefined
      ? {}
      : objectInput(
          input,
          ['include', 'exclude', 'minSizeBytes', 'maxSizeBytes'],
          'filters',
        );
  const v = {
    include: [],
    exclude: [],
    minSizeBytes: null,
    maxSizeBytes: null,
    ...previous,
    ...patch,
  };
  const result = {
    include: globs(v.include),
    exclude: globs(v.exclude),
    minSizeBytes:
      v.minSizeBytes === null
        ? null
        : number(v.minSizeBytes, 'filters.minSizeBytes'),
    maxSizeBytes:
      v.maxSizeBytes === null
        ? null
        : number(v.maxSizeBytes, 'filters.maxSizeBytes'),
  };
  if (
    result.minSizeBytes !== null &&
    result.maxSizeBytes !== null &&
    result.minSizeBytes > result.maxSizeBytes
  )
    invalid('filters');
  return result;
}
/** 合并创建或 PATCH，禁止目标 ID 跨 Job、复用归档 ID。
 * @param input 请求体。
 * @param previous 旧公共配置；创建时省略。
 * @param secrets 旧路径密码。
 * @returns 已规范化配置和密码。
 * @throws ApiError 字段验证失败。
 */
export function mergeJob(
  input: unknown,
  previous?: Job,
  secrets: PathSecrets = { sourcePassword: null, targetPasswords: {} },
): { job: Job; secrets: PathSecrets } {
  const v = objectInput(
    input,
    [
      'name',
      'source',
      'targets',
      'enabled',
      'cron',
      'timezone',
      'filters',
      'allowEmptySource',
      'syncEmptyDirs',
      'sourceDownloadConcurrency',
      'sourceScanIntervalSeconds',
      'relayBandwidthLimit',
      'retryCount',
      'timeoutSeconds',
      'notificationChannelIds',
    ],
    'job',
  );
  if (
    Object.values(v).every(
      /** 检查单个顶层字段是否省略。
       * @param value 请求字段值。
       * @returns 是否为 undefined。
       * @throws 不适用。
       */
      (value) => value === undefined,
    )
  )
    invalid('job');
  const now = new Date().toISOString();
  const sourceInput =
    v.source === undefined && previous
      ? {}
      : objectInput(
          v.source,
          ['instanceId', 'path', 'password', 'refresh'],
          'source',
        );
  const source = endpoint(
    sourceInput,
    previous?.source,
    secrets.sourcePassword,
    'source',
  );
  const targetPasswords: Record<string, string | null> = {};
  let targets: Target[];
  if (v.targets === undefined && previous) {
    targets = previous.targets;
    Object.assign(targetPasswords, secrets.targetPasswords);
  } else {
    if (
      !Array.isArray(v.targets) ||
      v.targets.length < 1 ||
      v.targets.length > 32
    )
      invalid('targets');
    targets = [];
    const seen = new Set<string>();
    for (const [index, item] of v.targets.entries()) {
      const field = `targets[${index}]`;
      const t = objectInput(
        item,
        [
          'id',
          'instanceId',
          'path',
          'password',
          'refresh',
          'mode',
          'createMode',
          'concurrentFiles',
          'scanIntervalSeconds',
          'chunkConcurrency',
          'deleteLimits',
        ],
        field,
      );
      const targetId =
        t.id === undefined ? randomUUID() : id(t.id, field + '.id');
      const old = previous?.targets.find(
        /** 在旧配置中查找同 ID 目标。
         * @param target 旧配置中的目标。
         * @returns 是否为当前请求的目标 ID。
         * @throws 不适用。
         */
        (target) => target.id === targetId,
      );
      if ((t.id !== undefined && !old) || seen.has(targetId))
        invalid(field + '.id');
      seen.add(targetId);
      const e = endpoint(
        t,
        old,
        secrets.targetPasswords[targetId] ?? null,
        field,
      );
      const mode = t.mode === undefined ? (old?.mode ?? 'incremental') : t.mode;
      if (mode !== 'incremental' && mode !== 'mirror') invalid(field + '.mode');
      const createMode =
        t.createMode === undefined
          ? (old?.createMode ?? 'relay')
          : t.createMode;
      if (createMode !== 'relay' && createMode !== 'server_copy')
        invalid(field + '.createMode');
      const concurrentFiles = number(
        t.concurrentFiles === undefined
          ? (old?.concurrentFiles ?? 2)
          : t.concurrentFiles,
        field + '.concurrentFiles',
      );
      const chunkConcurrency = number(
        t.chunkConcurrency === undefined
          ? (old?.chunkConcurrency ?? 2)
          : t.chunkConcurrency,
        field + '.chunkConcurrency',
        1,
        8,
      );
      targets.push({
        ...e.value,
        id: targetId,
        position: targets.length,
        mode,
        createMode,
        concurrentFiles,
        scanIntervalSeconds: number(
          t.scanIntervalSeconds === undefined
            ? (old?.scanIntervalSeconds ?? 0)
            : t.scanIntervalSeconds,
          field + '.scanIntervalSeconds',
          0,
          3600,
        ),
        chunkConcurrency,
        deleteLimits: limits(t.deleteLimits, old?.deleteLimits),
      });
      targetPasswords[targetId] = e.password;
    }
  }
  const channelIds = v.notificationChannelIds;
  if (
    channelIds !== undefined &&
    (!Array.isArray(channelIds) || channelIds.length !== 0)
  )
    invalid('notificationChannelIds');
  const cronValue = v.cron === undefined ? (previous?.cron ?? null) : v.cron;
  const job: Job = {
    id: previous?.id ?? randomUUID(),
    name: text(v.name === undefined ? previous?.name : v.name, 'name', 1, 100),
    source: source.value,
    targets,
    enabled: bool(
      v.enabled === undefined ? (previous?.enabled ?? false) : v.enabled,
      'enabled',
    ),
    cron: cronValue === null ? null : text(cronValue, 'cron', 1),
    timezone: text(
      v.timezone === undefined ? (previous?.timezone ?? 'UTC') : v.timezone,
      'timezone',
      1,
    ),
    filters: filters(v.filters, previous?.filters),
    allowEmptySource: bool(
      v.allowEmptySource === undefined
        ? (previous?.allowEmptySource ?? false)
        : v.allowEmptySource,
      'allowEmptySource',
    ),
    syncEmptyDirs: bool(
      v.syncEmptyDirs === undefined
        ? (previous?.syncEmptyDirs ?? false)
        : v.syncEmptyDirs,
      'syncEmptyDirs',
    ),
    sourceScanIntervalSeconds: number(
      v.sourceScanIntervalSeconds === undefined
        ? (previous?.sourceScanIntervalSeconds ?? 0)
        : v.sourceScanIntervalSeconds,
      'sourceScanIntervalSeconds',
      0,
      3600,
    ),
    sourceDownloadConcurrency: number(
      v.sourceDownloadConcurrency === undefined
        ? (previous?.sourceDownloadConcurrency ?? 2)
        : v.sourceDownloadConcurrency,
      'sourceDownloadConcurrency',
    ),
    relayBandwidthLimit: number(
      v.relayBandwidthLimit === undefined
        ? (previous?.relayBandwidthLimit ?? 0)
        : v.relayBandwidthLimit,
      'relayBandwidthLimit',
    ),
    retryCount:
      v.retryCount === undefined
        ? (previous?.retryCount ?? null)
        : v.retryCount === null
          ? null
          : number(v.retryCount, 'retryCount', 0, 9),
    timeoutSeconds: number(
      v.timeoutSeconds === undefined
        ? (previous?.timeoutSeconds ?? 86400)
        : v.timeoutSeconds,
      'timeoutSeconds',
      60,
      604800,
    ),
    notificationChannelIds: [],
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    archivedAt: null,
  };
  validateSchedule(job.cron, job.timezone);
  // source-only PATCH 也可能使保留的目标失效，必须检查完整合并结果。
  for (const [index, target] of job.targets.entries())
    if (
      target.createMode === 'server_copy' &&
      target.instanceId !== job.source.instanceId
    )
      invalid(
        `targets[${index}].createMode`,
        'Server copy requires the source Instance',
      );
  return { job, secrets: { sourcePassword: source.password, targetPasswords } };
}
