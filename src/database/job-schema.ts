// 定义 Job 与稳定 Target 配置表，删除仅逻辑归档。
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { instances } from './schema.js';

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey().notNull(),
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    sourceInstanceId: text('source_instance_id')
      .notNull()
      .references(
        /** 提供外键关联列，延迟解析避免表声明顺序依赖。
         * @param 不适用。
         * @returns 关联列。
         * @throws 不适用。
         */
        () => instances.id,
        { onDelete: 'restrict' },
      ),
    sourcePath: text('source_path').notNull(),
    sourcePasswordEnc: text('source_password_enc'),
    sourceRefresh: integer('source_refresh', { mode: 'boolean' })
      .notNull()
      .default(false),
    cron: text('cron'),
    timezone: text('timezone').notNull().default('UTC'),
    includeGlobs: text('include_globs_json', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
    excludeGlobs: text('exclude_globs_json', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
    minSizeBytes: integer('min_size_bytes'),
    maxSizeBytes: integer('max_size_bytes'),
    allowEmptySource: integer('allow_empty_source', { mode: 'boolean' })
      .notNull()
      .default(false),
    syncEmptyDirs: integer('sync_empty_dirs', { mode: 'boolean' })
      .notNull()
      .default(false),
    retryCount: integer('retry_count'),
    relayBandwidthLimit: integer('relay_bandwidth_limit').notNull().default(0),
    timeoutSeconds: integer('timeout_seconds').notNull().default(86400),
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  /** 生成 Job 输入的数据库约束。
   * @param t 表字段。
   * @returns CHECK 与索引。
   * @throws 不适用。
   */
  (t) => [
    index('jobs_enabled_archive').on(t.enabled, t.archivedAt),
    index('jobs_source').on(t.sourceInstanceId),
    check('jobs_name', sql`length(${t.name}) BETWEEN 1 AND 100`),
    check(
      'jobs_booleans',
      sql`${t.enabled} IN (0,1) AND ${t.sourceRefresh} IN (0,1) AND ${t.allowEmptySource} IN (0,1) AND ${t.syncEmptyDirs} IN (0,1)`,
    ),
    check(
      'jobs_globs',
      sql`json_valid(${t.includeGlobs}) AND json_valid(${t.excludeGlobs})`,
    ),
    check(
      'jobs_sizes',
      sql`(${t.minSizeBytes} IS NULL OR ${t.minSizeBytes} BETWEEN 0 AND 9007199254740991) AND (${t.maxSizeBytes} IS NULL OR ${t.maxSizeBytes} BETWEEN 0 AND 9007199254740991) AND (${t.minSizeBytes} IS NULL OR ${t.maxSizeBytes} IS NULL OR ${t.minSizeBytes} <= ${t.maxSizeBytes})`,
    ),
    check(
      'jobs_limits',
      sql`${t.timeoutSeconds} BETWEEN 60 AND 604800 AND ${t.relayBandwidthLimit} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'jobs_retry_count',
      sql`${t.retryCount} IS NULL OR ${t.retryCount} BETWEEN 0 AND 9`,
    ),
    check(
      'jobs_times',
      sql`${t.createdAt} >= 0 AND ${t.updatedAt} >= 0 AND (${t.archivedAt} IS NULL OR ${t.archivedAt} >= 0)`,
    ),
  ],
);

export const jobTargets = sqliteTable(
  'job_targets',
  {
    id: text('id').primaryKey().notNull(),
    jobId: text('job_id')
      .notNull()
      .references(
        /** 提供外键关联列，延迟解析避免表声明顺序依赖。
         * @param 不适用。
         * @returns 关联列。
         * @throws 不适用。
         */
        () => jobs.id,
        { onDelete: 'restrict' },
      ),
    instanceId: text('instance_id')
      .notNull()
      .references(
        /** 提供外键关联列，延迟解析避免表声明顺序依赖。
         * @param 不适用。
         * @returns 关联列。
         * @throws 不适用。
         */
        () => instances.id,
        { onDelete: 'restrict' },
      ),
    path: text('path').notNull(),
    passwordEnc: text('password_enc'),
    position: integer('position').notNull(),
    mode: text('mode', { enum: ['incremental', 'mirror'] })
      .notNull()
      .default('incremental'),
    createMode: text('create_mode', { enum: ['relay', 'server_copy'] })
      .notNull()
      .default('relay'),
    refresh: integer('refresh', { mode: 'boolean' }).notNull().default(false),
    deleteLimitsEnabled: integer('delete_limits_enabled', { mode: 'boolean' })
      .notNull()
      .default(true),
    maxDeleteCount: integer('max_delete_count'),
    maxDeletePercent: integer('max_delete_percent'),
    // 只表示被配置更新移出成员集合；Job 归档不写此列，NULL 仅说明是成员，能否使用还取决于父 Job。
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  /** 生成目标位置及阈值约束。
   * @param t 表字段。
   * @returns CHECK 与索引。
   * @throws 不适用。
   */
  (t) => [
    // 同一 Job 的成员 position 唯一；归档 Job 保留其最终成员的唯一项，不影响其他 Job。
    uniqueIndex('job_targets_position')
      .on(t.jobId, t.position)
      .where(sql`${t.archivedAt} IS NULL`),
    index('job_targets_instance_archive').on(t.instanceId, t.archivedAt),
    check('job_targets_position_nonnegative', sql`${t.position} >= 0`),
    check('job_targets_mode', sql`${t.mode} IN ('incremental','mirror')`),
    check(
      'job_targets_create_mode',
      sql`${t.createMode} IN ('relay','server_copy')`,
    ),
    check(
      'job_targets_booleans',
      sql`${t.refresh} IN (0,1) AND ${t.deleteLimitsEnabled} IN (0,1)`,
    ),
    check(
      'job_targets_limits',
      sql`(${t.deleteLimitsEnabled} = 0 OR ${t.maxDeleteCount} IS NOT NULL OR ${t.maxDeletePercent} IS NOT NULL) AND (${t.maxDeleteCount} IS NULL OR ${t.maxDeleteCount} BETWEEN 0 AND 9007199254740991) AND (${t.maxDeletePercent} IS NULL OR ${t.maxDeletePercent} BETWEEN 0 AND 100)`,
    ),
    check(
      'job_targets_times',
      sql`${t.createdAt} >= 0 AND ${t.updatedAt} >= 0 AND (${t.archivedAt} IS NULL OR ${t.archivedAt} >= 0)`,
    ),
  ],
);

/** Job 持久化字段，含仅内部可用的密文。 */
export type JobRecord = typeof jobs.$inferSelect;
/** Target 持久化字段。 */
export type TargetRecord = typeof jobTargets.$inferSelect;
