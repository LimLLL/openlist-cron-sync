// 定义持久化计划及依赖，保留规范中的执行字段但不实现执行器。
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { instances } from './schema.js';
import { runs, runTargets } from './run-schema.js';
import { OPERATION_STATUSES } from '../runs/run-types.js';

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
    retryOf: text('retry_of').references(
      /** 提供外键关联列，延迟解析避免表声明顺序依赖。
       * @param 不适用。
       * @returns 关联列。
       * @throws 不适用。
       */
      (): AnySQLiteColumn => operations.id,
      {
        onDelete: 'restrict',
      },
    ),
    causedByOperationId: text('caused_by_operation_id').references(
      /** 提供外键关联列，延迟解析避免表声明顺序依赖。
       * @param 不适用。
       * @returns 关联列。
       * @throws 不适用。
       */
      (): AnySQLiteColumn => operations.id,
      { onDelete: 'restrict' },
    ),
    attemptNo: integer('attempt_no').notNull().default(1),
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
    unknownUntil: integer('unknown_until'),
    quarantineReleasedAt: integer('quarantine_released_at'),
    quarantineReleaseReason: text('quarantine_release_reason'),
    reobservedAt: integer('reobserved_at'),
    reobservedByRunId: text('reobserved_by_run_id').references(
      /** 提供外键关联列，延迟解析避免表声明顺序依赖。
       * @param 不适用。
       * @returns 关联列。
       * @throws 不适用。
       */
      () => runs.id,
      {
        onDelete: 'restrict',
      },
    ),
    resolutionKind: text('resolution_kind', {
      enum: ['observed', 'superseded', 'abandoned'],
    }),
    resolutionNote: text('resolution_note'),
    resolvedAt: integer('resolved_at'),
    resolvedByRunId: text('resolved_by_run_id').references(
      /** 提供外键关联列，延迟解析避免表声明顺序依赖。
       * @param 不适用。
       * @returns 关联列。
       * @throws 不适用。
       */
      () => runs.id,
      {
        onDelete: 'restrict',
      },
    ),
  },
  /** 生成操作组合、状态、大小及责任字段约束。
   * @param t 表字段。
   * @returns CHECK 与索引。
   * @throws 不适用。
   */
  (t) => [
    uniqueIndex('operations_run_seq').on(t.runId, t.seq),
    uniqueIndex('operations_task')
      .on(t.targetInstanceId, t.openlistTaskId)
      .where(sql`${t.openlistTaskId} IS NOT NULL`),
    uniqueIndex('operations_upload')
      .on(t.targetInstanceId, t.multipartUploadId)
      .where(sql`${t.multipartUploadId} IS NOT NULL`),
    index('operations_target_status_seq').on(t.runTargetId, t.status, t.seq),
    index('operations_retry').on(t.status, t.nextAttemptAt),
    index('operations_path').on(t.targetInstanceId, t.targetPath),
    index('operations_unknown').on(t.status, t.unknownUntil),
    index('operations_cleanup').on(t.remoteCleanupPending),
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
    check('operations_positive', sql`${t.seq} >= 1 AND ${t.attemptNo} >= 1`),
    check(
      'operations_booleans',
      sql`${t.isDir} IN (0,1) AND ${t.remoteCleanupPending} IN (0,1)`,
    ),
    check(
      'operations_sizes',
      sql`${t.affectedFileCount} BETWEEN 0 AND 9007199254740991 AND ${t.affectedBytes} BETWEEN 0 AND 9007199254740991 AND ${t.bytesDownloaded} BETWEEN 0 AND 9007199254740991 AND ${t.bytesTransferred} BETWEEN 0 AND 9007199254740991 AND (${t.expectedSourceSize} IS NULL OR ${t.expectedSourceSize} BETWEEN 0 AND 9007199254740991) AND (${t.expectedTargetSize} IS NULL OR ${t.expectedTargetSize} BETWEEN 0 AND 9007199254740991)`,
    ),
    check(
      'operations_terminal',
      sql`${t.status} NOT IN ('succeeded','failed','skipped','unknown','cancelled') OR ${t.endedAt} IS NOT NULL`,
    ),
    check(
      'operations_unknown_fields',
      sql`${t.status} != 'unknown' OR (${t.unknownSince} IS NOT NULL AND ${t.unknownUntil} IS NOT NULL AND ${t.unknownUntil} >= ${t.unknownSince})`,
    ),
    check(
      'operations_resolution',
      sql`${t.resolutionKind} IS NULL OR (${t.resolutionKind} IN ('observed','superseded','abandoned') AND ${t.resolvedAt} IS NOT NULL AND (${t.resolutionKind} != 'abandoned' OR ${t.resolutionNote} IS NOT NULL))`,
    ),
    check(
      'operations_task_method',
      sql`${t.method} = 'server_copy' OR (${t.openlistTaskId} IS NULL AND ${t.remoteState} IS NULL)`,
    ),
    check(
      'operations_cleanup_task',
      sql`${t.remoteCleanupPending} = 0 OR ${t.openlistTaskId} IS NOT NULL`,
    ),
    check(
      'operations_multipart_method',
      sql`${t.method} = 'relay' OR (${t.multipartUploadId} IS NULL AND ${t.multipartChunkSize} IS NULL AND ${t.multipartState} IS NULL AND ${t.multipartAttempt} IS NULL AND ${t.sourceStreamCompletedAt} IS NULL)`,
    ),
    check(
      'operations_cause',
      sql`(${t.causedByOperationId} IS NULL AND (${t.errorCode} IS NULL OR ${t.errorCode} != 'REMOTE_TASK_CHANGED')) OR (${t.causedByOperationId} IS NOT NULL AND ${t.errorCode} = 'REMOTE_TASK_CHANGED' AND ${t.openlistTaskId} IS NULL)`,
    ),
  ],
);

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
  /** 约束依赖边；同 Run 与无环由计划写入器验证。
   * @param t 表字段。
   * @returns 主键、反向索引与 CHECK。
   * @throws 不适用。
   */
  (t) => [
    primaryKey({ columns: [t.operationId, t.dependsOnId] }),
    // 删除被阻断或失败时按被依赖方查找下游 create，避免每批扫描整张依赖表。
    index('operation_dependencies_depends_on').on(t.dependsOnId),
    check('dependencies_not_self', sql`${t.operationId} != ${t.dependsOnId}`),
  ],
);

/** 完整操作存储记录。 */
export type OperationRecord = typeof operations.$inferSelect;
