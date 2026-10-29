// 描述运行快照、计划操作和诊断的公开形状及预览计数语义。
import type { SchemaObject } from '@nestjs/swagger';
import {
  arraySchema,
  booleanSchema,
  idSchema,
  nullable,
  objectSchema,
  sizeSchema,
  stringSchema,
  timeSchema,
} from '../common/api-schema.js';
import { jobViewSchema, targetViewSchema } from '../jobs/api-schemas.js';
import { emptyStats } from '../sync/stats.js';
import { executionSettings } from '../configuration/execution-settings.js';
import { RETRY_REASONS } from './retry-scope.js';
import { RUN_STATUSES, OPERATION_STATUSES } from './run-types.js';

const statsSchema = {
  ...objectSchema(
    Object.fromEntries(
      Object.keys(emptyStats()).map(
        /** 为一个统计字段生成非负整数属性。
         * @param key 统计字段名。
         * @returns 字段名与整数 schema 的属性条目。
         * @throws 不适用。
         */
        (key) => [key, sizeSchema],
      ),
    ),
  ),
  description:
    '运行列表和详情在planned/executing/cancelling/recovering时读取实时SQL聚合，排队、扫描和终态读取持久化统计；逻辑动作读取Operation结果，字节含全部attempt及重传；relay进度约5秒持久化；预览执行结果和实际字节为0；源计数只计一次。retryOfRunId非空时只统计范围项及必要祖先；源文件已确认消失的noop也计入unchangedFiles，过滤不计入成功；不表示全树扫描完成',
};
const errorSchema = nullable(
  objectSchema({ code: stringSchema, message: stringSchema }),
);
const instanceSchema = objectSchema({
  id: idSchema,
  name: stringSchema,
  baseUrl: stringSchema,
  authMode: { type: 'string', enum: ['token', 'password'] },
  username: nullable(stringSchema),
  accountUsername: nullable(stringSchema),
  accountBasePath: stringSchema,
  accountRole: sizeSchema,
  accountPermissions: sizeSchema,
  downloadMode: { type: 'string', enum: ['d', 'p'] },
});
export const runViewSchema = objectSchema({
  id: idSchema,
  jobId: idSchema,
  retryOfRunId: {
    ...nullable(idSchema),
    description: '非空表示范围重试；软链接，父历史清理后仍保留',
  },
  retrySourceExists: {
    ...booleanSchema,
    description: '来源Run是否仍存在；普通Run为false',
  },
  trigger: { type: 'string', enum: ['manual', 'cron'] },
  scheduledAt: nullable(timeSchema),
  dryRun: booleanSchema,
  confirmDeletes: booleanSchema,
  status: { type: 'string', enum: [...RUN_STATUSES] },
  stats: statsSchema,
  stopReason: nullable({
    type: 'string',
    enum: ['USER_CANCEL', 'RUN_TIMEOUT', 'PROCESS_RESTART'],
  }),
  error: errorSchema,
  createdAt: timeSchema,
  updatedAt: timeSchema,
  startedAt: nullable(timeSchema),
  scanCompletedAt: nullable(timeSchema),
  endedAt: nullable(timeSchema),
  deadlineAt: nullable(timeSchema),
  queueDeadlineAt: timeSchema,
  cancelRequestedAt: nullable(timeSchema),
  recoveryDeadlineAt: nullable(timeSchema),
});
/** 列表名称来自冻结快照，不扩展触发/取消响应或持久化Run状态。 */
export const runListItemSchema = objectSchema({
  ...(runViewSchema.properties as Record<string, SchemaObject>),
  jobName: {
    type: 'string',
    description:
      '接受运行时config.job.name的冻结名称，不随当前Job改名或归档改变',
  },
});
const runTargetSchema = objectSchema({
  id: idSchema,
  targetId: idSchema,
  instanceName: stringSchema,
  config: objectSchema({ target: targetViewSchema, instance: instanceSchema }),
  stats: statsSchema,
  sourceComplete: {
    ...booleanSchema,
    description: '重试Run仅表示共享源范围观察完整，不证明全树完整',
  },
  targetComplete: {
    ...booleanSchema,
    description: '重试Run仅表示此目标范围观察完整',
  },
  suspect: booleanSchema,
  deleteBlocked: booleanSchema,
  extrasBlocked: booleanSchema,
  blockReasons: {
    ...arraySchema(stringSchema),
    description:
      '有效扫描/安全阻断码；DELETE_BLOCKED 的具体原因在这里和 issues 中',
  },
  observedTargetFileCount: {
    ...sizeSchema,
    description:
      '删除分母D；重试仅计范围内符合managed规则的目标文件，无关兄弟不计',
  },
  plannedReplaceCount: sizeSchema,
  plannedExtraCount: sizeSchema,
  deleteBudgetCount: {
    ...nullable(sizeSchema),
    description:
      '扫描阻断为 0；否则是数值删除预算，阈值禁用/confirmDeletes 时 null；null 不是删除许可，仍须满足全部保护',
  },
});
export const runDetailSchema = objectSchema({
  ...(runViewSchema.properties as Record<string, SchemaObject>),
  sourceInstanceName: stringSchema,
  config: objectSchema({
    snapshotVersion: { type: 'integer', enum: [1] },
    job: jobViewSchema,
    instances: { type: 'object', additionalProperties: instanceSchema },
    settings: objectSchema(
      Object.fromEntries(
        Object.keys(executionSettings({})).map(
          /** 为一个固定运行参数字段生成非负整数属性。
           * @param key 运行参数字段名。
           * @returns 字段名与整数 schema 的属性条目。
           * @throws 不适用。
           */
          (key) => [key, sizeSchema],
        ),
      ),
    ),
  }),
  targets: arraySchema(runTargetSchema),
  issueCount: sizeSchema,
  retryEligibility: {
    ...objectSchema({
      eligible: booleanSchema,
      reason: nullable({ type: 'string', enum: [...RETRY_REASONS] }),
      candidateFiles: sizeSchema,
      candidateDirectories: sizeSchema,
      excludedItems: sizeSchema,
    }),
    description:
      '最新终态正式Run、未过保留期、Job空闲且源instanceId/path不变才计算候选；前置资格失败时计数为0。候选按Target和路径去重，仅创建/替换文件及目录自身；excludedItems是因目标移除或instanceId/path改变排除的项。候选数不是执行数，POST事务内复查；不包含队列容量或服务就绪。',
  },
});
export const operationViewSchema = objectSchema({
  id: idSchema,
  runId: idSchema,
  runTargetId: idSchema,
  seq: {
    type: 'integer',
    minimum: 1,
    description: 'Run 内从 1 开始的计划顺序',
  },
  action: { type: 'string', enum: ['mkdir', 'create', 'delete'] },
  method: { type: 'string', enum: ['mkdir', 'relay', 'server_copy', 'remove'] },
  reason: {
    type: 'string',
    enum: ['prepare', 'new', 'replace', 'extra', 'retry_cleanup'],
  },
  status: { type: 'string', enum: [...OPERATION_STATUSES] },
  sourceInstanceId: nullable(idSchema),
  sourceInstanceName: nullable(stringSchema),
  sourcePath: nullable(stringSchema),
  targetInstanceId: idSchema,
  targetInstanceName: stringSchema,
  targetPath: stringSchema,
  isDir: booleanSchema,
  expectedSourceSize: nullable(sizeSchema),
  expectedTargetSize: nullable(sizeSchema),
  affectedFileCount: sizeSchema,
  affectedBytes: sizeSchema,
  attemptCount: {
    type: 'integer',
    minimum: 1,
    maximum: 10,
    description:
      '已存在的尝试数，包含退避等待中的pending尝试；受Run冻结重试预算限制',
  },
  bytesDownloaded: { ...sizeSchema, description: '全部尝试累计下载字节' },
  bytesTransferred: {
    ...sizeSchema,
    description: '全部尝试累计上传payload字节',
  },
  error: {
    ...errorSchema,
    description:
      '当前尝试的错误，等待下一次重试时为null。DELETE_BLOCKED：删除保护；DELETE_LIMIT：数值/清理预算拒绝；SPOOL_FULL：真实ENOSPC/EDQUOT或session落库后独占容量不足，摘要区分insufficient spool capacity；PLAN_INTERRUPTED：旧计划失效',
  },
  createdAt: timeSchema,
  updatedAt: timeSchema,
  submittedAt: {
    ...nullable(timeSchema),
    description: '最早一次非空的尝试提交时间',
  },
  endedAt: {
    ...nullable(timeSchema),
    description: '逻辑操作终态时间，等待重试时为null',
  },
  unknownSince: {
    ...nullable(timeSchema),
    description: '当前尝试进入unknown的时间',
  },
});
/** 每次执行的完整公开事实；数组上限来自已冻结的重试预算。 */
export const attemptViewSchema = objectSchema({
  id: idSchema,
  attemptNo: { type: 'integer', minimum: 1, maximum: 10 },
  status: { type: 'string', enum: [...OPERATION_STATUSES] },
  task: nullable(
    objectSchema({ id: stringSchema, state: nullable({ type: 'integer' }) }),
  ),
  multipart: nullable(
    objectSchema({
      uploadId: stringSchema,
      chunkSize: sizeSchema,
      state: nullable(stringSchema),
      attempt: nullable(sizeSchema),
      sourceStreamCompletedAt: nullable(timeSchema),
    }),
  ),
  remoteCleanupPending: booleanSchema,
  bytesDownloaded: sizeSchema,
  bytesTransferred: sizeSchema,
  error: errorSchema,
  createdAt: timeSchema,
  updatedAt: timeSchema,
  submittedAt: nullable(timeSchema),
  endedAt: nullable(timeSchema),
  nextAttemptAt: nullable(timeSchema),
  unknownSince: nullable(timeSchema),
});
/** 操作详情内嵌全部尝试，列表仍只返回摘要。 */
export const operationDetailSchema = objectSchema({
  ...operationViewSchema.properties,
  attempts: { ...arraySchema(attemptViewSchema), minItems: 1, maxItems: 10 },
});
export const issueViewSchema = objectSchema({
  id: idSchema,
  runId: idSchema,
  runTargetId: nullable(idSchema),
  endpointRole: { type: 'string', enum: ['source', 'target'] },
  instanceId: idSchema,
  path: stringSchema,
  code: stringSchema,
  message: stringSchema,
  protectSubtree: booleanSchema,
  createdAt: timeSchema,
});
