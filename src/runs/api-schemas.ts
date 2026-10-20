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
    '预览执行结果和实际字节为0；真实结果按逻辑动作最后attempt计算，传输字节含重传；目录删除不计文件数；源计数只计一次',
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
  limits: objectSchema(
    Object.fromEntries(
      [
        'maxApiConcurrency',
        'apiRequestsPerSecond',
        'maxOutstandingTasks',
        'maxDownloadConnections',
        'maxUploadSessions',
        'maxChunkConcurrency',
      ].map(
        /** 为一个实例限额字段生成非负整数属性。
         * @param key 实例限额字段名。
         * @returns 字段名与整数 schema 的属性条目。
         * @throws 不适用。
         */
        (key) => [key, sizeSchema],
      ),
    ),
  ),
});
export const runViewSchema = objectSchema({
  id: idSchema,
  jobId: idSchema,
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
const runTargetSchema = objectSchema({
  id: idSchema,
  targetId: idSchema,
  config: objectSchema({ target: targetViewSchema, instance: instanceSchema }),
  stats: statsSchema,
  sourceComplete: booleanSchema,
  targetComplete: booleanSchema,
  suspect: booleanSchema,
  deleteBlocked: booleanSchema,
  extrasBlocked: booleanSchema,
  blockReasons: {
    ...arraySchema(stringSchema),
    description:
      '有效扫描/安全阻断码；DELETE_BLOCKED 的具体原因在这里和 issues 中',
  },
  observedTargetFileCount: sizeSchema,
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
  sourcePath: nullable(stringSchema),
  targetInstanceId: idSchema,
  targetPath: stringSchema,
  isDir: booleanSchema,
  expectedSourceSize: nullable(sizeSchema),
  expectedTargetSize: nullable(sizeSchema),
  affectedFileCount: sizeSchema,
  affectedBytes: sizeSchema,
  retryOf: nullable(idSchema),
  causedByOperationId: nullable(idSchema),
  attemptNo: { type: 'integer', minimum: 1 },
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
  bytesDownloaded: sizeSchema,
  bytesTransferred: sizeSchema,
  error: {
    ...errorSchema,
    description:
      'DELETE_BLOCKED：删除保护；DELETE_LIMIT：数值/清理预算拒绝；PREVIOUS_OUTCOME_UNKNOWN：隔离或重新观察失败；SPOOL_FULL：真实ENOSPC/EDQUOT或session落库后独占容量不足，摘要区分insufficient spool capacity；PLAN_INTERRUPTED：旧计划失效',
  },
  createdAt: timeSchema,
  updatedAt: timeSchema,
  submittedAt: nullable(timeSchema),
  endedAt: nullable(timeSchema),
  unknownSince: nullable(timeSchema),
  unknownUntil: nullable(timeSchema),
  quarantineReleasedAt: nullable(timeSchema),
  quarantineReleaseReason: nullable(stringSchema),
  reobservedAt: nullable(timeSchema),
  resolution: nullable(
    objectSchema({
      kind: { type: 'string', enum: ['observed', 'superseded', 'abandoned'] },
      note: nullable(stringSchema),
      resolvedAt: timeSchema,
      runId: nullable(idSchema),
    }),
  ),
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
