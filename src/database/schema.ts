// 汇总生产业务表，迁移由 drizzle-kit 生成。
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const admins = sqliteTable(
  'admins',
  {
    id: integer('id').primaryKey(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    tokenVersion: integer('token_version').notNull().default(1),
    mustChangePassword: integer('must_change_password', {
      mode: 'boolean',
    }).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  /** 生成单管理员及基本数据约束。
   * @param table 管理员表字段。
   * @returns SQL CHECK 列表。
   * @throws 不适用。
   */
  (table) => [
    check('admins_singleton', sql`${table.id} = 1`),
    check(
      'admins_username_length',
      sql`length(${table.username}) BETWEEN 1 AND 64`,
    ),
    check(
      'admins_token_version',
      sql`${table.tokenVersion} BETWEEN 1 AND 9007199254740991`,
    ),
    check('admins_must_change', sql`${table.mustChangePassword} IN (0, 1)`),
    check(
      'admins_timestamps',
      sql`${table.createdAt} >= 0 AND ${table.updatedAt} >= 0`,
    ),
  ],
);

/** 管理员存储记录；字段对应表中的身份、哈希、撤销版本、改密标志和 UTC 毫秒时间。 */
export type AdminRecord = typeof admins.$inferSelect;

export const instances = sqliteTable(
  'instances',
  {
    id: text('id').primaryKey().notNull(),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    authMode: text('auth_mode', { enum: ['token', 'password'] }).notNull(),
    username: text('username'),
    secretEnc: text('secret_enc'),
    authState: text('auth_state', {
      enum: ['untested', 'ready', 'auth_blocked'],
    })
      .notNull()
      .default('untested'),
    authBlockReason: text('auth_block_reason'),
    authBlockedUntil: integer('auth_blocked_until'),
    accountUsername: text('account_username'),
    accountBasePath: text('account_base_path'),
    accountRole: integer('account_role'),
    accountPermissions: integer('account_permissions'),
    maxApiConcurrency: integer('max_api_concurrency').notNull().default(4),
    apiRequestsPerSecond: integer('api_requests_per_second')
      .notNull()
      .default(5),
    downloadMode: text('download_mode', { enum: ['d', 'p'] })
      .notNull()
      .default('d'),
    lastTestAt: integer('last_test_at'),
    openlistVersion: text('openlist_version'),
    multipartEnabled: integer('multipart_enabled', { mode: 'boolean' }),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  /** 声明实例枚举、范围和分页索引。
   * @param table 实例列。
   * @returns 约束与索引。
   * @throws 不适用。
   */
  (table) => [
    index('instances_archive_created_id').on(
      table.archivedAt,
      table.createdAt,
      table.id,
    ),
    check('instances_name', sql`length(${table.name}) BETWEEN 1 AND 100`),
    check(
      'instances_auth_mode',
      sql`${table.authMode} IN ('token','password')`,
    ),
    check(
      'instances_username',
      sql`(${table.authMode} = 'token' AND ${table.username} IS NULL) OR (${table.authMode} = 'password' AND length(${table.username}) > 0 AND ${table.username} IS NOT NULL)`,
    ),
    check(
      'instances_auth_state',
      sql`${table.authState} IN ('untested','ready','auth_blocked')`,
    ),
    check('instances_download_mode', sql`${table.downloadMode} IN ('d','p')`),
    check(
      'instances_api_concurrency',
      sql`${table.maxApiConcurrency} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'instances_api_rate',
      sql`${table.apiRequestsPerSecond} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'instances_multipart',
      sql`${table.multipartEnabled} IS NULL OR ${table.multipartEnabled} IN (0,1)`,
    ),
    check(
      'instances_times',
      sql`${table.createdAt} >= 0 AND ${table.updatedAt} >= 0 AND (${table.archivedAt} IS NULL OR ${table.archivedAt} >= 0) AND (${table.lastTestAt} IS NULL OR ${table.lastTestAt} >= 0) AND (${table.authBlockedUntil} IS NULL OR ${table.authBlockedUntil} >= 0)`,
    ),
  ],
);

/** 实例存储记录；字段对应配置、凭据密文、身份事实、配额与 UTC 毫秒时间。 */
export type InstanceRecord = typeof instances.$inferSelect;

/** 实例可更新字段；字段含义继承实例表，省略表示保留。 */
export type InstanceChanges = Partial<typeof instances.$inferInsert>;

export { jobs, jobTargets } from './job-schema.js';
export { runs, runTargets, scanIssues } from './run-schema.js';
export { operations, operationDependencies } from './operation-schema.js';
