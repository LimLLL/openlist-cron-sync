// 描述 Job 创建、合并补丁与完整公共响应的 OpenAPI 契约。
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

const endpointInput = {
  instanceId: idSchema,
  path: {
    type: 'string',
    description: '账号内绝对路径；≤4096 UTF-8 bytes；禁止 /@s 前缀',
  } as SchemaObject,
  password: {
    type: 'string',
    minLength: 1,
    nullable: true,
    writeOnly: true,
    format: 'password',
    description: '创建省略无密码；PATCH 省略保留，null 清除；不接受空字符串',
  } as SchemaObject,
  refresh: { type: 'boolean', default: false } as SchemaObject,
};
const deleteLimitFields = {
  enabled: { type: 'boolean', default: true } as SchemaObject,
  maxCount: { ...nullable(sizeSchema), default: 1000 },
  maxPercent: {
    type: 'integer',
    minimum: 0,
    maximum: 100,
    nullable: true,
    default: 50,
  } as SchemaObject,
};
const filterFields = {
  include: {
    ...arraySchema({ type: 'string', maxLength: 1024 }),
    maxItems: 100,
    default: [],
  },
  exclude: {
    ...arraySchema({ type: 'string', maxLength: 1024 }),
    maxItems: 100,
    default: [],
  },
  minSizeBytes: { ...nullable(sizeSchema), default: null },
  maxSizeBytes: { ...nullable(sizeSchema), default: null },
};
const targetInputFields = {
  ...endpointInput,
  mode: {
    type: 'string',
    enum: ['incremental', 'mirror'],
    default: 'incremental',
  } as SchemaObject,
  deleteLimits: {
    ...objectSchema(deleteLimitFields, []),
    description: '按字段合并；enabled=true 时不能同时禁用两个阈值',
  },
};
const jobFields = {
  name: { type: 'string', minLength: 1, maxLength: 100 } as SchemaObject,
  source: objectSchema(endpointInput, ['instanceId', 'path']),
  targets: {
    ...arraySchema(objectSchema(targetInputFields, ['instanceId', 'path'])),
    minItems: 1,
    maxItems: 32,
  },
  createMode: {
    type: 'string',
    enum: ['relay', 'server_copy'],
    default: 'relay',
    description:
      'server_copy 要求全部 Target 与源同 Instance；真实执行逐tid跟踪',
  } as SchemaObject,
  enabled: {
    type: 'boolean',
    default: false,
    description: '启用cron；禁用仍允许显式手动执行',
  } as SchemaObject,
  cron: {
    type: 'string',
    nullable: true,
    default: null,
    description: '仅五段分钟表达式；拒绝宏、秒字段；INVALID_CRON',
  } as SchemaObject,
  timezone: {
    type: 'string',
    default: 'UTC',
    description: 'IANA 时区；cron=null 时也校验',
  } as SchemaObject,
  filters: objectSchema(filterFields, []),
  allowEmptySource: { type: 'boolean', default: false } as SchemaObject,
  syncEmptyDirs: { type: 'boolean', default: false } as SchemaObject,
  relayBandwidthLimit: {
    ...sizeSchema,
    default: 0,
    description: 'relay聚合上传bytes/s；0不限',
  },
  timeoutSeconds: {
    type: 'integer',
    minimum: 60,
    maximum: 604800,
    default: 86400,
    description: '从扫描开始计时，含规划；不含排队',
  } as SchemaObject,
  notificationChannelIds: {
    ...arraySchema(idSchema),
    maxItems: 0,
    default: [],
    description: '通知关联随M7接入，当前只接受省略或 []',
  },
};
export const jobCreateSchema = objectSchema(jobFields, [
  'name',
  'source',
  'targets',
]);
export const jobPatchSchema: SchemaObject = {
  ...objectSchema(
    {
      ...jobFields,
      source: objectSchema(endpointInput, []),
      targets: {
        ...arraySchema({
          oneOf: [
            objectSchema(targetInputFields, ['instanceId', 'path']),
            objectSchema({ id: idSchema, ...targetInputFields }, ['id']),
          ],
        }),
        minItems: 1,
        maxItems: 32,
        description:
          '完整目标集合；已有 id 合并，新项无 id；移除归档，id 不复用',
      },
    },
    [],
  ),
  minProperties: 1,
};
export const endpointViewSchema = objectSchema({
  instanceId: idSchema,
  path: stringSchema,
  hasPassword: booleanSchema,
  refresh: booleanSchema,
});
export const targetViewSchema = objectSchema({
  ...(endpointViewSchema.properties as Record<string, SchemaObject>),
  id: idSchema,
  position: sizeSchema,
  mode: targetInputFields.mode,
  deleteLimits: objectSchema(deleteLimitFields),
});
export const jobViewSchema = objectSchema({
  ...jobFields,
  id: idSchema,
  source: endpointViewSchema,
  targets: arraySchema(targetViewSchema),
  filters: objectSchema(filterFields),
  createdAt: timeSchema,
  updatedAt: timeSchema,
  archivedAt: nullable(timeSchema),
});
