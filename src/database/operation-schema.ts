// 分离稳定逻辑操作与每次执行事实；依赖只引用逻辑操作。
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { instances } from './schema.js';
import { runs, runTargets } from './run-schema.js';
import { OPERATION_STATUSES } from '../runs/run-types.js';

/** 每个RunTarget中的一个逻辑动作；身份、计划序号与依赖在重试期间保持稳定。 */
export const operations = sqliteTable(
  'operations',
  {
    id: text('id').primaryKey().notNull(),
    runId: text('run_id')
      .notNull()
      .references(
        /** 提供外键关联列，延迟解析避免表声明顺序依赖。
         * @param 不适用。
         * @returns 关联列。
         * @throws 不适用。
         */
        () => runs.id,
        { onDelete: 'restrict' },
      ),
    runTargetId: text('run_target_id')
      .notNull()
      .references(
        /** 提供外键关联列，延迟解析避免表声明顺序依赖。
         * @param 不适用。
         * @returns 关联列。
         * @throws 不适用。
         */
        () => runTargets.id,
        { onDelete: 'restrict' },
      ),
    seq: integer('seq').notNull(),
    action: text('action', { enum: ['mkdir', 'create', 'delete'] }).notNull(),
    method: text('method', {
      enum: ['mkdir', 'server_copy', 'relay', 'remove'],
    }).notNull(),
    reason: text('reason', {
      enum: ['prepare', 'new', 'replace', 'extra', 'retry_cleanup'],
    }).notNull(),
    status: text('status', { enum: OPERATION_STATUSES })
      .notNull()
      .default('pending'),
    sourceInstanceId: text('source_instance_id').references(
      /** 提供外键关联列，延迟解析避免表声明顺序依赖。
       * @param 不适用。
       * @returns 关联列。
       * @throws 不适用。
       */
      () => instances.id,
      { onDelete: 'restrict' },
    ),
    sourcePath: text('source_path'),
    targetInstanceId: text('target_instance_id')
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
    targetPath: text('target_path').notNull(),
    isDir: integer('is_dir', { mode: 'boolean' }).notNull(),
    expectedSourceSize: integer('expected_source_size'),
    expectedTargetSize: integer('expected_target_size'),
    expectedSourceModified: text('expected_source_modified'),
    affectedFileCount: integer('affected_file_count').notNull(),
    affectedBytes: integer('affected_bytes').notNull(),
    attemptCount: integer('attempt_count').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    endedAt: integer('ended_at'),
  },
  /** 生成逻辑操作的身份、结果和计划约束。
   * @param t 当前表列。
   * @returns 索引、外键及CHECK定义。
   * @throws 不适用。
   */
  (t) => [
    uniqueIndex('operations_run_seq').on(t.runId, t.seq),
    uniqueIndex('operations_attempt_identity').on(
      t.id,
      t.targetInstanceId,
      t.method,
    ),
    index('operations_target_status_seq').on(t.runTargetId, t.status, t.seq),
    index('operations_target_instance').on(t.targetInstanceId),
    index('operations_source_instance')
      .on(t.sourceInstanceId)
      .where(sql`${t.sourceInstanceId} IS NOT NULL`),
    index('operations_status').on(t.status),
    check(
      'operations_method',
      sql`(${t.action} = 'mkdir' AND ${t.method} = 'mkdir') OR (${t.action} = 'create' AND ${t.method} IN ('relay','server_copy')) OR (${t.action} = 'delete' AND ${t.method} = 'remove')`,
    ),
    check(
      'operations_reason',
      sql`${t.reason} IN ('prepare','new','replace','extra','retry_cleanup')`,
    ),
    check(
      'operations_status',
      sql`${t.status} IN ('pending','submitting','submitted','running','succeeded','failed','skipped','unknown','cancelled')`,
    ),
    check('operations_positive', sql`${t.seq} >= 1 AND ${t.attemptCount} >= 1`),
    check('operations_boolean', sql`${t.isDir} IN (0,1)`),
    check(
      'operations_sizes',
      sql`${t.affectedFileCount} BETWEEN 0 AND 9007199254740991 AND ${t.affectedBytes} BETWEEN 0 AND 9007199254740991 AND (${t.expectedSourceSize} IS NULL OR ${t.expectedSourceSize} BETWEEN 0 AND 9007199254740991) AND (${t.expectedTargetSize} IS NULL OR ${t.expectedTargetSize} BETWEEN 0 AND 9007199254740991)`,
    ),
    check(
      'operations_terminal',
      sql`${t.status} NOT IN ('succeeded','failed','skipped','unknown','cancelled') OR ${t.endedAt} IS NOT NULL`,
    ),
  ],
);

/** 每次尝试独立持有远端副作用；终态结果不可被后续维护改写。 */
export const operationAttempts = sqliteTable(
  'operation_attempts',
  {
    id: text('id').primaryKey().notNull(),
    operationId: text('operation_id').notNull(),
    // 复合外键绑定父操作身份，保留实例内task唯一性及方法CHECK。
    targetInstanceId: text('target_instance_id').notNull(),
    method: text('method', {
      enum: ['mkdir', 'server_copy', 'relay', 'remove'],
    }).notNull(),
    attemptNo: integer('attempt_no').notNull().default(1),
    status: text('status', { enum: OPERATION_STATUSES })
      .notNull()
      .default('pending'),
    openlistTaskId: text('openlist_task_id'),
    remoteState: integer('remote_state'),
    remoteCleanupPending: integer('remote_cleanup_pending', { mode: 'boolean' })
      .notNull()
      .default(false),
    bytesDownloaded: integer('bytes_downloaded').notNull().default(0),
    bytesTransferred: integer('bytes_transferred').notNull().default(0),
    multipartUploadId: text('multipart_upload_id'),
    multipartChunkSize: integer('multipart_chunk_size'),
    multipartState: text('multipart_state'),
    multipartAttempt: integer('multipart_attempt'),
    sourceStreamCompletedAt: integer('source_stream_completed_at'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    submittedAt: integer('submitted_at'),
    endedAt: integer('ended_at'),
    nextAttemptAt: integer('next_attempt_at'),
    unknownSince: integer('unknown_since'),
  },
  /** 绑定父身份并约束尝试编号、在途唯一性及远端责任。
   * @param t 当前表列。
   * @returns 索引、外键及CHECK定义。
   * @throws 不适用。
   */
  (t) => [
    foreignKey({
      columns: [t.operationId, t.targetInstanceId, t.method],
      foreignColumns: [
        operations.id,
        operations.targetInstanceId,
        operations.method,
      ],
    }).onDelete('restrict'),
    uniqueIndex('attempts_operation_no').on(t.operationId, t.attemptNo),
    uniqueIndex('attempts_active')
      .on(t.operationId)
      .where(
        sql`${t.status} IN ('pending','submitting','submitted','running')`,
      ),
    uniqueIndex('attempts_task')
      .on(t.targetInstanceId, t.openlistTaskId)
      .where(sql`${t.openlistTaskId} IS NOT NULL`),
    index('attempts_cleanup')
      .on(t.id)
      .where(sql`${t.remoteCleanupPending} = 1`),
    check('attempts_number', sql`${t.attemptNo} >= 1`),
    check(
      'attempts_status',
      sql`${t.status} IN ('pending','submitting','submitted','running','succeeded','failed','skipped','unknown','cancelled')`,
    ),
    check('attempts_boolean', sql`${t.remoteCleanupPending} IN (0,1)`),
    check(
      'attempts_bytes',
      sql`${t.bytesDownloaded} BETWEEN 0 AND 9007199254740991 AND ${t.bytesTransferred} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'attempts_terminal',
      sql`${t.status} NOT IN ('succeeded','failed','skipped','unknown','cancelled') OR ${t.endedAt} IS NOT NULL`,
    ),
    check(
      'attempts_unknown',
      sql`${t.status} != 'unknown' OR ${t.unknownSince} IS NOT NULL`,
    ),
    check(
      'attempts_task_method',
      sql`${t.method} = 'server_copy' OR (${t.openlistTaskId} IS NULL AND ${t.remoteState} IS NULL)`,
    ),
    check(
      'attempts_cleanup_task',
      sql`${t.remoteCleanupPending} = 0 OR ${t.openlistTaskId} IS NOT NULL`,
    ),
    check(
      'attempts_multipart_method',
      sql`${t.method} = 'relay' OR (${t.multipartUploadId} IS NULL AND ${t.multipartChunkSize} IS NULL AND ${t.multipartState} IS NULL AND ${t.multipartAttempt} IS NULL AND ${t.sourceStreamCompletedAt} IS NULL)`,
    ),
  ],
);

// Drizzle当前不表达WITHOUT ROWID；发行迁移以同一复合主键创建实际表。
export const operationDependencies = sqliteTable(
  'operation_dependencies',
  {
    operationId: text('operation_id')
      .notNull()
      .references(
        /** 提供外键关联列，延迟解析避免表声明顺序依赖。
         * @param 不适用。
         * @returns 关联列。
         * @throws 不适用。
         */
        () => operations.id,
        { onDelete: 'restrict' },
      ),
    dependsOnId: text('depends_on_id')
      .notNull()
      .references(
        /** 提供外键关联列，延迟解析避免表声明顺序依赖。
         * @param 不适用。
         * @returns 关联列。
         * @throws 不适用。
         */
        () => operations.id,
        { onDelete: 'restrict' },
      ),
  },
  /** 约束逻辑依赖边；同RunTarget和无环由规划器及迁移验证。
   * @param t 当前表列。
   * @returns 索引、外键及CHECK定义。
   * @throws 不适用。
   */
  (t) => [
    primaryKey({ columns: [t.operationId, t.dependsOnId] }),
    // 删除被阻断或失败时按被依赖方查找下游 create，避免每批扫描整张依赖表。
    index('operation_dependencies_depends_on').on(t.dependsOnId),
    check('dependencies_not_self', sql`${t.operationId} != ${t.dependsOnId}`),
  ],
);

/** 稳定逻辑操作记录。 */
export type OperationRecord = typeof operations.$inferSelect;
/** 一次执行的持久化事实。 */
export type AttemptRecord = typeof operationAttempts.$inferSelect;
/** 执行器输入：计划与指定尝试；id始终为Attempt ID，operationId为逻辑ID。 */
export type ExecutionRecord = Omit<OperationRecord, keyof AttemptRecord> &
  AttemptRecord;
