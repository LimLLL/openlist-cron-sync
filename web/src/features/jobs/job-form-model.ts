// 校验 Job 表单并序列化删除阈值；空值与省略具有不同的 PATCH 语义。
import type { TFunction } from 'i18next';
import i18n from '../../i18n';
import type enJobs from '../../i18n/locales/en/jobs';
import type { JobView } from './job-contract';

/** 可本地化的表单校验错误键。 */
export type JobValidationKey = keyof (typeof enJobs)['validation'];
/** 数值字段名称键。 */
export type JobFieldKey = keyof (typeof enJobs)['field'];

/** 校验错误参数；field 为字段名称键，渲染时再翻译。 */
export interface JobValidationParams {
  /** 出错的数值字段。 */
  field?: JobFieldKey;
  /** 包含的下界。 */
  min?: number;
  /** 包含的上界。 */
  max?: number;
}

/** 按给定语言的 t 生成校验错误文案。
 * @param key 校验错误键。
 * @param params 字段与范围参数。
 * @param t 绑定 jobs 命名空间的翻译函数。
 * @returns 本地化文案。
 * @throws 不适用。
 */
export function jobValidationText(
  key: JobValidationKey,
  params: JobValidationParams,
  t: TFunction<'jobs'>,
): string {
  if (key === 'integerRange')
    return t('validation.integerRange', {
      field: params.field ? t(`field.${params.field}`) : '',
      min: params.min ?? 0,
      max: params.max ?? Number.MAX_SAFE_INTEGER,
    });
  return t(`validation.${key}`);
}

/** 表单校验错误：携带翻译键供界面本地化，message 固定为英文便于测试与日志。 */
export class JobFormError extends Error {
  /** 创建校验错误。
   * @param key 校验错误键。
   * @param params 字段与范围参数。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    readonly key: JobValidationKey,
    readonly params: JobValidationParams = {},
  ) {
    super(jobValidationText(key, params, i18n.getFixedT('en', 'jobs')));
    this.name = 'JobFormError';
  }
}

/** 表单中一个目标的配置。 */
export interface TargetInput {
  /** 已有目标 UUID；新增目标没有 ID。 */
  existingId?: string;
  /** 实例 UUID。 */
  instanceId: string;
  /** 账号路径。 */
  path: string;
  /** 新路径密码；空字符串保留已存密码。 */
  password: string;
  /** 同步模式。 */
  mode: 'incremental' | 'mirror';
  /** 此目标的文件创建方式。 */
  createMode: 'relay' | 'server_copy';
  /** 同时处理的文件或复制任务数；0 不限。 */
  concurrentFiles: string;
  /** 每个中转文件的分片并发，1–8。 */
  chunkConcurrency: string;
  /** 是否刷新扫描缓存。 */
  refresh: boolean;
  /** 是否启用删除阈值。 */
  deleteLimitsEnabled: boolean;
  /** 数量阈值；空字符串明确禁用这一项。 */
  maxCount: string;
  /** 百分比阈值；空字符串明确禁用这一项。 */
  maxPercent: string;
}

/** Job 表单输入，不包含凭据之外的客户端状态。 */
export interface JobFormValues {
  /** 名称。 */
  name: string;
  /** 源实例。 */
  sourceInstanceId: string;
  /** 源路径。 */
  sourcePath: string;
  /** 新源路径密码。 */
  sourcePassword: string;
  /** 源扫描刷新。 */
  sourceRefresh: boolean;
  /** 同时从源读取的中转文件数；0 不限。 */
  sourceDownloadConcurrency: string;
  /** 完整目标集合。 */
  targets: TargetInput[];
  /** 五段 cron；空字符串表示手动。 */
  cron: string;
  /** IANA 时区。 */
  timezone: string;
  /** 每行一个 include 模式。 */
  includePatterns: string;
  /** 每行一个 exclude 模式。 */
  excludePatterns: string;
  /** 最小字节数，空字符串无界。 */
  minSizeBytes: string;
  /** 最大字节数，空字符串无界。 */
  maxSizeBytes: string;
  /** 允许有效空源的删除。 */
  allowEmptySource: boolean;
  /** 同步空目录。 */
  syncEmptyDirs: boolean;
  /** 失败后的重试次数；空字符串继承进程默认值。 */
  retryCount: string;
  /** 此 Job 所有 relay Target 的聚合上传字节每秒。 */
  relayBandwidthLimit: string;
  /** 超时秒数。 */
  timeoutSeconds: string;
}

/** 创建与后端默认值一致的目标。
 * @param 不适用。
 * @returns 默认目标输入。
 * @throws 不适用。
 */
export function emptyTarget(): TargetInput {
  return {
    instanceId: '',
    path: '/',
    password: '',
    mode: 'incremental',
    createMode: 'relay',
    concurrentFiles: '2',
    chunkConcurrency: '2',
    refresh: false,
    deleteLimitsEnabled: true,
    maxCount: '1000',
    maxPercent: '50',
  };
}

/** 从已有配置生成编辑值，保留目标 ID 和无界阈值。
 * @param job 已存 Job。
 * @returns 编辑目标集合。
 * @throws 不适用。
 */
export function targetsFromJob(job: JobView): TargetInput[] {
  return job.targets.map((target) => ({
    existingId: target.id,
    instanceId: target.instanceId,
    path: target.path,
    password: '',
    mode: target.mode,
    createMode: target.createMode,
    concurrentFiles: target.concurrentFiles.toString(),
    chunkConcurrency: target.chunkConcurrency.toString(),
    refresh: target.refresh,
    deleteLimitsEnabled: target.deleteLimits.enabled,
    maxCount: target.deleteLimits.maxCount?.toString() ?? '',
    maxPercent: target.deleteLimits.maxPercent?.toString() ?? '',
  }));
}

/** 根据当前实例选择计算创建方式状态，不修改用户选值或保存位置相关的错误。
 * 只有源与目标都已选择且为同一实例时，server_copy 才可选。
 * @param sourceInstanceId 当前源实例；未选择时为空字符串。
 * @param target 当前目标。
 * @returns server_copy 是否不可选，以及现有选择是否无效。
 * @throws 不适用。
 */
export function targetCreateModeState(
  sourceInstanceId: string,
  target: Pick<TargetInput, 'instanceId' | 'createMode'>,
): { unavailable: boolean; invalid: boolean } {
  const unavailable =
    sourceInstanceId === '' ||
    target.instanceId === '' ||
    target.instanceId !== sourceInstanceId;
  return {
    unavailable,
    invalid: unavailable && target.createMode === 'server_copy',
  };
}

/** 把目录选择器的结果写回对应端点，其余字段与目标顺序保持不变。
 * @param values 当前表单值。
 * @param endpoint 'source' 表示源，数字表示目标位置。
 * @param path 服务端规范化后的目录路径。
 * @param password 选择器中填写的路径密码。
 * @returns 新表单值；目标位置已不存在时原样返回。
 * @throws 不适用。
 */
export function applyBrowsedPath(
  values: JobFormValues,
  endpoint: 'source' | number,
  path: string,
  password: string,
): JobFormValues {
  if (endpoint === 'source')
    return { ...values, sourcePath: path, sourcePassword: password };
  if (!values.targets[endpoint]) return values;
  return {
    ...values,
    targets: values.targets.map((target, position) =>
      position === endpoint ? { ...target, path, password } : target,
    ),
  };
}

/** 读取完整数值，拒绝 parseInt 截断小数或指数后的错误数值。
 * @param input 数字输入。
 * @param field 字段名称键。
 * @param min 包含的下界。
 * @param max 包含的上界。
 * @returns 安全整数。
 * @throws JobFormError 空值、非整数或范围非法。
 */
function integer(
  input: string,
  field: JobFieldKey,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const value = Number(input);
  if (
    !input.trim() ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new JobFormError('integerRange', { field, min, max });
  return value;
}

/** 校验路径并按后端规则去除重复斜线，不解码百分号。
 * @param input 用户路径。
 * @returns 规范化账号路径。
 * @throws JobFormError 路径不符合端点约束。
 */
function path(input: string): string {
  const segments = input.split('/').filter(Boolean);
  const normalized = '/' + segments.join('/');
  const encoder = new TextEncoder();
  if (
    !input.startsWith('/') ||
    // oxlint-disable-next-line no-control-regex -- 账号路径禁止控制字符。
    /[\u0000-\u001f\u007f-\u009f\\]/u.test(input) ||
    new TextDecoder().decode(encoder.encode(input)) !== input ||
    encoder.encode(input).length > 4096 ||
    normalized.startsWith('/@s') ||
    segments.some(
      (segment) =>
        segment === '.' ||
        segment === '..' ||
        encoder.encode(segment).length > 1024,
    )
  )
    throw new JobFormError('path');
  return normalized;
}

/** 读取按行排列的过滤规则，保留模式中的有效空格。
 * @param input 多行输入。
 * @returns 非空规则数组。
 * @throws JobFormError 规则数量、长度或反选前缀非法。
 */
function patterns(input: string): string[] {
  const values = input.split(/\r?\n/).filter((value) => value !== '');
  if (
    values.length > 100 ||
    values.some((value) => [...value].length > 1024 || value.startsWith('!'))
  )
    throw new JobFormError('patterns');
  return values;
}

/** 校验并生成创建或更新请求；现有目标 ID 和空密码的保留语义不变。
 * @param values 当前表单值。
 * @returns 供 Job API 使用的完整可编辑配置。
 * @throws JobFormError 本地边界或跨字段约束不成立；完整 cron/glob 语义仍由后端验证。
 */
export function buildJobInput(values: JobFormValues) {
  if ([...values.name].length < 1 || [...values.name].length > 100)
    throw new JobFormError('nameLength');
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(values.sourceInstanceId) ||
    values.targets.some((target) => !uuid.test(target.instanceId))
  )
    throw new JobFormError('instanceRequired');
  if (values.targets.length < 1 || values.targets.length > 32)
    throw new JobFormError('targetCount');
  if (
    values.targets.some(
      (target) =>
        targetCreateModeState(values.sourceInstanceId, target).invalid,
    )
  )
    throw new JobFormError('serverCopySameInstance');
  const cron = values.cron.trim() || null;
  if (cron !== null && cron.split(/\s+/).length !== 5)
    throw new JobFormError('cronFields');
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: values.timezone }).format();
  } catch {
    throw new JobFormError('timezoneInvalid');
  }
  if (!values.timezone) throw new JobFormError('timezoneRequired');
  const minSizeBytes =
    values.minSizeBytes === '' ? null : integer(values.minSizeBytes, 'minSize');
  const maxSizeBytes =
    values.maxSizeBytes === '' ? null : integer(values.maxSizeBytes, 'maxSize');
  if (
    minSizeBytes !== null &&
    maxSizeBytes !== null &&
    minSizeBytes > maxSizeBytes
  )
    throw new JobFormError('sizeOrder');
  const source = {
    instanceId: values.sourceInstanceId,
    path: path(values.sourcePath),
    ...(values.sourcePassword ? { password: values.sourcePassword } : {}),
    refresh: values.sourceRefresh,
  };
  const targets = values.targets.map((target) => {
    const maxCount =
      target.maxCount === '' ? null : integer(target.maxCount, 'deleteCount');
    const maxPercent =
      target.maxPercent === ''
        ? null
        : integer(target.maxPercent, 'deletePercent', 0, 100);
    if (target.deleteLimitsEnabled && maxCount === null && maxPercent === null)
      throw new JobFormError('thresholdRequired');
    return {
      ...(target.existingId ? { id: target.existingId } : {}),
      instanceId: target.instanceId,
      path: path(target.path),
      ...(target.password ? { password: target.password } : {}),
      mode: target.mode,
      createMode: target.createMode,
      concurrentFiles: integer(target.concurrentFiles, 'concurrentFiles'),
      chunkConcurrency: integer(
        target.chunkConcurrency,
        'chunkConcurrency',
        1,
        8,
      ),
      refresh: target.refresh,
      deleteLimits: {
        enabled: target.deleteLimitsEnabled,
        maxCount,
        maxPercent,
      },
    };
  });
  return {
    name: values.name,
    source,
    targets,
    cron,
    timezone: values.timezone,
    filters: {
      include: patterns(values.includePatterns),
      exclude: patterns(values.excludePatterns),
      minSizeBytes,
      maxSizeBytes,
    },
    allowEmptySource: values.allowEmptySource,
    syncEmptyDirs: values.syncEmptyDirs,
    sourceDownloadConcurrency: integer(
      values.sourceDownloadConcurrency,
      'sourceDownloadConcurrency',
    ),
    retryCount:
      values.retryCount === ''
        ? null
        : integer(values.retryCount, 'retryCount', 0, 9),
    relayBandwidthLimit: integer(values.relayBandwidthLimit, 'bandwidth'),
    timeoutSeconds: integer(values.timeoutSeconds, 'timeout', 60, 604800),
  };
}
