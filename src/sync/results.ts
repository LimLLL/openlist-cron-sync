// 共用逻辑操作结果聚合；传输及删除字节读取全部尝试，历史终态仍由Run保存。
import { eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { runTargets } from '../database/run-schema.js';
import type { RunRecord, RunTargetRecord } from '../database/run-schema.js';
import { addStat, PlanError } from './stats.js';
import type { Stats } from './stats.js';

/** 一个Target的逻辑执行结果及删除保护。 */
export interface TargetResult {
  /** 固定扫描事实和当前执行统计。 */
  target: RunTargetRecord;
  /** 至少一个成功动作或unchanged。 */
  success: boolean;
  /** 至少一个非正常缺失的失败/未知/取消动作。 */
  failed: boolean;
  /** 存在有效降级原因。 */
  degraded: boolean;
}

/** 由操作行决定、活动Run需实时聚合的统计项；其余统计保留规划阶段的落库值。 */
const LIVE_KEYS = [
  'succeededCreates',
  'deletedForReplace',
  'deletedAsExtra',
  'failedOperations',
  'unknownOperations',
  'skippedOperations',
  'cancelledOperations',
  'retryAttempts',
  'downloadedBytes',
  'transferredBytes',
  'actualDeletedBytes',
] as const;
/** 一个Run Target的SQL聚合行；统计列与Stats同名，没有操作的Target不出现。 */
type LiveRow = Record<(typeof LIVE_KEYS)[number], number | null> & {
  /** Run Target ID。 */
  runTargetId: string;
  /** 按首次出现seq排序的阻断原因JSON数组。 */
  blockReasons: string;
  /** 结果为succeeded的逻辑操作数。 */
  successfulOperations: number;
  /** 失败、未知或取消且不是正常缺失的逻辑操作数。 */
  necessaryFailures: number;
};

/** 在SQL内分别聚合操作与尝试，避免一对多连接重复计算逻辑动作。
 * @param db 单写连接。
 * @param condition 仅作用于操作别名o的Run/Target及阶段条件。
 * @returns 每个Target一行聚合，不把完整历史加载进内存。
 * @throws PlanError 整数溢出；Error 数据库失败。
 */
function aggregate(
  db: BetterSQLite3Database,
  condition: SQL,
): Map<string, LiveRow> {
  try {
    const rows = db.all<LiveRow>(sql`
      WITH selected AS MATERIALIZED (
        SELECT o.id,o.run_target_id,o.seq,o.status,o.action,o.reason,o.is_dir,
          o.affected_bytes,o.attempt_count,a.error_code FROM operations o
        JOIN operation_attempts a ON a.operation_id=o.id AND a.attempt_no=o.attempt_count
        WHERE ${condition}
      ), bytes AS MATERIALIZED (
        SELECT o.run_target_id, sum(a.bytes_downloaded) AS downloaded,
          sum(a.bytes_transferred) AS transferred,
          sum(CASE WHEN o.action='delete' AND a.status='succeeded' THEN o.affected_bytes ELSE 0 END) AS deleted
        FROM selected o JOIN operation_attempts a ON a.operation_id=o.id GROUP BY o.run_target_id
      ), reasons AS MATERIALIZED (
        SELECT run_target_id, coalesce(error_code,'DEPENDENCY_FAILED') AS code, min(seq) AS first_seq
        FROM selected WHERE status IN ('failed','unknown','cancelled','skipped')
          AND error_code IS NOT 'PRECONDITION_ALREADY_ABSENT' GROUP BY run_target_id,code
      )
      SELECT o.run_target_id AS runTargetId,
        sum(o.status='succeeded' AND o.action='create') AS succeededCreates,
        sum(o.status='succeeded' AND o.action='delete' AND NOT o.is_dir AND o.reason='replace') AS deletedForReplace,
        sum(o.status='succeeded' AND o.action='delete' AND NOT o.is_dir AND o.reason='extra') AS deletedAsExtra,
        sum(o.status='failed') AS failedOperations, sum(o.status='unknown') AS unknownOperations,
        sum(o.status='skipped') AS skippedOperations, sum(o.status='cancelled') AS cancelledOperations,
        sum(o.attempt_count-1) AS retryAttempts,
        b.downloaded AS downloadedBytes, b.transferred AS transferredBytes, b.deleted AS actualDeletedBytes,
        sum(o.status='succeeded') AS successfulOperations,
        sum(o.status IN ('failed','unknown','cancelled') AND o.error_code IS NOT 'PRECONDITION_ALREADY_ABSENT') AS necessaryFailures,
        (SELECT json_group_array(code) FROM (SELECT code FROM reasons r WHERE r.run_target_id=o.run_target_id ORDER BY first_seq,code)) AS blockReasons
      FROM selected o JOIN bytes b ON b.run_target_id=o.run_target_id GROUP BY o.run_target_id
    `);
    return new Map(
      rows.map(
        /** 转为Run Target ID与聚合行的映射条目。
         * @param row 聚合行。
         * @returns 映射条目。
         * @throws 不适用。
         */
        (row) => [row.runTargetId, row],
      ),
    );
  } catch (error) {
    if (error instanceof Error && /integer overflow/i.test(error.message))
      throw new PlanError('RESOURCE_LIMIT');
    throw error;
  }
}

/** 将当前执行计数合入Target的扫描事实，正常缺失不阻断extras。
 * @param target 原Target。
 * @param row SQL聚合结果，无动作时undefined。
 * @returns 完整Target结果。
 * @throws PlanError 计数超过安全整数。
 */
function apply(
  target: RunTargetRecord,
  row: LiveRow | undefined,
): TargetResult {
  const stats: Stats = { ...target.stats };
  for (const key of LIVE_KEYS) {
    stats[key] = 0;
    addStat(stats, key, Number(row?.[key] ?? 0));
  }
  const reasons = new Set(target.blockReasons);
  for (const reason of JSON.parse(row?.blockReasons ?? '[]') as string[])
    reasons.add(reason);
  return {
    target: {
      ...target,
      stats,
      extrasBlocked: reasons.size > 0,
      blockReasons: [...reasons],
    },
    success: stats.unchangedFiles > 0 || (row?.successfulOperations ?? 0) > 0,
    failed: (row?.necessaryFailures ?? 0) > 0,
    degraded: reasons.size > 0,
  };
}

/** 计算整个Run的Target结果，所有读入口共用相同SQL口径。
 * @param db 数据库。
 * @param run 固定Run。
 * @returns 各Target当前结果与Run统计。
 * @throws PlanError 数值溢出；Error 数据库失败。
 */
function aggregateRun(db: BetterSQLite3Database, run: RunRecord) {
  const rows = aggregate(db, sql`o.run_id=${run.id}`);
  const results = db
    .select()
    .from(runTargets)
    .where(eq(runTargets.runId, run.id))
    .all()
    .map(
      /** 用聚合行覆盖一个Target的执行统计。
       * @param target 当前目标事实。
       * @returns 目标结果。
       * @throws PlanError 统计超出安全整数。
       */
      (target) => apply(target, rows.get(target.id)),
    );
  const targets = results.map(
    /** 提取应与Run一起展示或保存的目标事实。
     * @param result 目标结果。
     * @returns 目标记录。
     * @throws 不适用。
     */
    (result) => result.target,
  );
  const stats: Stats = { ...run.stats };
  for (const key of Object.keys(stats) as (keyof Stats)[]) {
    if (['sourceFiles', 'sourceDirectories', 'filteredFiles'].includes(key))
      continue;
    stats[key] = 0;
    for (const target of targets) addStat(stats, key, target.stats[key]);
  }
  return { results, targets, stats };
}

/** 读取活动Run的实时统计，不修改持久化终态。
 * @param db 数据库。
 * @param run 固定Run。
 * @returns 当前Target和Run统计。
 * @throws PlanError 数值溢出；Error 数据库失败。
 */
export function liveRunResult(db: BetterSQLite3Database, run: RunRecord) {
  const { targets, stats } = aggregateRun(db, run);
  return { targets, stats };
}

/** 计算一个Target的结果或创建阶段结束后的extras准入。
 * @param db 数据库。
 * @param target 固定Target。
 * @param createsOnly 排除尚未执行的extras动作。
 * @returns 目标结果。
 * @throws PlanError 数值溢出；Error 数据库失败。
 */
export function targetResult(
  db: BetterSQLite3Database,
  target: RunTargetRecord,
  createsOnly = false,
): TargetResult {
  return apply(
    target,
    aggregate(
      db,
      sql`o.run_target_id=${target.id} ${createsOnly ? sql`AND o.reason!='extra'` : sql``}`,
    ).get(target.id),
  );
}

/** 计算Run终态；调用方与Target、Operation收尾一起提交。
 * @param db 数据库或外层终态事务。
 * @param run 固定Run。
 * @returns 状态、Target及统计。
 * @throws PlanError 数值溢出；Error 数据库失败。
 */
export function runResult(db: BetterSQLite3Database, run: RunRecord) {
  const { results, targets, stats } = aggregateRun(db, run);
  let degraded = false;
  let success = false;
  let failed = false;
  for (const result of results) {
    degraded ||= result.degraded;
    success ||= result.success;
    failed ||= result.failed;
  }
  const status = !degraded
    ? 'succeeded'
    : failed && !success
      ? 'failed'
      : 'partial';
  return { targets, stats, status } as const;
}
