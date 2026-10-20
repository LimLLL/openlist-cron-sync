// 定义运行快照、目标扫描事实与诊断表。
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
import { jobs, jobTargets } from './job-schema.js';
import { RUN_STATUSES } from '../runs/run-types.js';
import type { RunConfig, InstanceSnapshot } from '../runs/run-types.js';
import type { Target } from '../jobs/job-types.js';
import type { Stats } from '../sync/stats.js';

export const runs = sqliteTable(
  'runs',
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
    trigger: text('trigger', { enum: ['manual', 'cron'] }).notNull(),
    scheduledAt: integer('scheduled_at'),
    dryRun: integer('dry_run', { mode: 'boolean' }).notNull(),
    confirmDeletes: integer('confirm_deletes', { mode: 'boolean' }).notNull(),
    status: text('status', { enum: RUN_STATUSES }).notNull(),
    config: text('run_config_json', { mode: 'json' })
      .$type<RunConfig>()
      .notNull(),
    secretSnapshotEnc: text('secret_snapshot_enc'),
    stats: text('stats_json', { mode: 'json' }).$type<Stats>().notNull(),
    stopReason: text('stop_reason'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    queueDeadlineAt: integer('queue_deadline_at').notNull(),
    startedAt: integer('started_at'),
    scanCompletedAt: integer('scan_completed_at'),
    endedAt: integer('ended_at'),
    deadlineAt: integer('deadline_at'),
    cancelRequestedAt: integer('cancel_requested_at'),
    recoveryDeadlineAt: integer('recovery_deadline_at'),
  },
  /** 约束运行状态、快照和唯一活动 Job。
   * @param t 表字段。
   * @returns CHECK 与索引。
   * @throws 不适用。
   */
  (t) => [
    uniqueIndex('runs_active_job')
      .on(t.jobId)
      .where(
        sql`${t.status} IN ('queued','scanning','planned','executing','cancelling','recovering')`,
      ),
    index('runs_created_id').on(t.createdAt, t.id),
    index('runs_job_created_id').on(t.jobId, t.createdAt, t.id),
    index('runs_status_created_id').on(t.status, t.createdAt, t.id),
    check(
      'runs_status',
      sql`${t.status} IN ('queued','scanning','planned','executing','cancelling','recovering','succeeded','partial','failed','cancelled','interrupted')`,
    ),
    check('runs_trigger', sql`${t.trigger} IN ('manual','cron')`),
    check(
      'runs_booleans',
      sql`${t.dryRun} IN (0,1) AND ${t.confirmDeletes} IN (0,1)`,
    ),
    check('runs_json', sql`json_valid(${t.config}) AND json_valid(${t.stats})`),
    check(
      'runs_terminal',
      sql`${t.status} NOT IN ('succeeded','partial','failed','cancelled','interrupted') OR ${t.endedAt} IS NOT NULL`,
    ),
    check(
      'runs_times',
      sql`${t.createdAt} >= 0 AND ${t.updatedAt} >= 0 AND ${t.queueDeadlineAt} >= ${t.createdAt} AND (${t.startedAt} IS NULL OR ${t.startedAt} >= 0) AND (${t.endedAt} IS NULL OR ${t.endedAt} >= 0) AND (${t.deadlineAt} IS NULL OR ${t.deadlineAt} >= 0)`,
    ),
  ],
);

export const runTargets = sqliteTable(
  'run_targets',
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
    targetId: text('target_id')
      .notNull()
      .references(
        /** 提供外键关联列，延迟解析避免表声明顺序依赖。
         * @param 不适用。
         * @returns 关联列。
         * @throws 不适用。
         */
        () => jobTargets.id,
        { onDelete: 'restrict' },
      ),
    config: text('target_snapshot_json', { mode: 'json' })
      .$type<{ target: Target; instance: InstanceSnapshot }>()
      .notNull(),
    stats: text('stats_json', { mode: 'json' }).$type<Stats>().notNull(),
    sourceComplete: integer('source_complete', { mode: 'boolean' })
      .notNull()
      .default(false),
    targetComplete: integer('target_complete', { mode: 'boolean' })
      .notNull()
      .default(false),
    suspect: integer('suspect', { mode: 'boolean' }).notNull().default(false),
    deleteBlocked: integer('delete_blocked', { mode: 'boolean' })
      .notNull()
      .default(false),
    extrasBlocked: integer('extras_blocked', { mode: 'boolean' })
      .notNull()
      .default(false),
    blockReasons: text('block_reasons_json', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
    observedTargetFileCount: integer('observed_target_file_count')
      .notNull()
      .default(0),
    plannedReplaceCount: integer('planned_replace_count').notNull().default(0),
    plannedExtraCount: integer('planned_extra_count').notNull().default(0),
    deleteBudgetCount: integer('delete_budget_count'),
  },
  /** 约束目标唯一性和扫描统计。
   * @param t 表字段。
   * @returns CHECK 与索引。
   * @throws 不适用。
   */
  (t) => [
    uniqueIndex('run_targets_run_target').on(t.runId, t.targetId),
    index('run_targets_run').on(t.runId),
    check(
      'run_targets_json',
      sql`json_valid(${t.config}) AND json_valid(${t.stats}) AND json_valid(${t.blockReasons})`,
    ),
    check(
      'run_targets_booleans',
      sql`${t.sourceComplete} IN (0,1) AND ${t.targetComplete} IN (0,1) AND ${t.suspect} IN (0,1) AND ${t.deleteBlocked} IN (0,1) AND ${t.extrasBlocked} IN (0,1)`,
    ),
    check(
      'run_targets_counts',
      sql`${t.observedTargetFileCount} BETWEEN 0 AND 9007199254740991 AND ${t.plannedReplaceCount} BETWEEN 0 AND 9007199254740991 AND ${t.plannedExtraCount} BETWEEN 0 AND 9007199254740991 AND (${t.deleteBudgetCount} IS NULL OR ${t.deleteBudgetCount} BETWEEN 0 AND 9007199254740991)`,
    ),
  ],
);

export const scanIssues = sqliteTable(
  'scan_issues',
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
    runTargetId: text('run_target_id').references(
      /** 提供外键关联列，延迟解析避免表声明顺序依赖。
       * @param 不适用。
       * @returns 关联列。
       * @throws 不适用。
       */
      () => runTargets.id,
      {
        onDelete: 'restrict',
      },
    ),
    endpointRole: text('endpoint_role', {
      enum: ['source', 'target'],
    }).notNull(),
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
    code: text('code').notNull(),
    message: text('message').notNull(),
    protectSubtree: integer('protect_subtree', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  /** 生成诊断分页与类型约束。
   * @param t 表字段。
   * @returns CHECK 与索引。
   * @throws 不适用。
   */
  (t) => [
    index('scan_issues_run_id').on(t.runId, t.id),
    index('scan_issues_target_path').on(t.runTargetId, t.path),
    check('scan_issues_role', sql`${t.endpointRole} IN ('source','target')`),
    check('scan_issues_protection', sql`${t.protectSubtree} IN (0,1)`),
  ],
);

/** Run 数据库记录。 */
export type RunRecord = typeof runs.$inferSelect;
/** Run Target 数据库记录。 */
export type RunTargetRecord = typeof runTargets.$inferSelect;
