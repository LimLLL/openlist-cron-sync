// 按逻辑动作最后attempt聚合执行结果，传输字节仍累计全部尝试。
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { operations } from '../database/operation-schema.js';
import { runTargets } from '../database/run-schema.js';
import type { RunRecord, RunTargetRecord } from '../database/run-schema.js';
import { addStat } from './stats.js';
import type { Stats } from './stats.js';

/** 当前Target的收敛结果。 */
export interface TargetResult {
  /** 固定扫描事实和最新实际统计。 */
  target: RunTargetRecord;
  /** 至少有一次成功动作或unchanged。 */
  success: boolean;
  /** 必要动作存在失败。 */
  failed: boolean;
  /** 存在降级原因。 */
  degraded: boolean;
}
/** 计算一个Target当前结果，不将历史失败重新阻断extras。
 * @param db 数据库。
 * @param target 当前目标扫描事实。
 * @param createsOnly 只计算准备和创建阶段的extras准入。
 * @returns 目标聚合。
 * @throws PlanError 聚合溢出；Error 数据库失败。
 */
export function targetResult(
  db: BetterSQLite3Database,
  target: RunTargetRecord,
  createsOnly = false,
): TargetResult {
  const stats: Stats = {
    ...target.stats,
    succeededCreates: 0,
    deletedForReplace: 0,
    deletedAsExtra: 0,
    failedOperations: 0,
    unknownOperations: 0,
    skippedOperations: 0,
    cancelledOperations: 0,
    retryAttempts: 0,
    downloadedBytes: 0,
    transferredBytes: 0,
    actualDeletedBytes: 0,
  };
  let success = stats.unchangedFiles > 0;
  let failed = false;
  const reasons = new Set(target.blockReasons);
  let after = 0;
  for (;;) {
    const rows = db
      .select({
        operation: operations,
        latest: sql<number>`NOT EXISTS (SELECT 1 FROM operations newer WHERE newer.target_instance_id = operations.target_instance_id AND newer.target_path = operations.target_path AND newer.run_id = operations.run_id AND newer.retry_of = coalesce(operations.retry_of, operations.id) AND newer.attempt_no > operations.attempt_no)`,
      })
      .from(operations)
      .where(
        and(eq(operations.runTargetId, target.id), gt(operations.seq, after)),
      )
      .orderBy(asc(operations.seq))
      .limit(256)
      .all();
    if (!rows.length) break;
    for (const { operation: op, latest } of rows) {
      after = op.seq;
      if (createsOnly && op.reason === 'extra') continue;
      addStat(stats, 'downloadedBytes', op.bytesDownloaded);
      addStat(stats, 'transferredBytes', op.bytesTransferred);
      if (op.retryOf) addStat(stats, 'retryAttempts');
      if (op.status === 'succeeded' && op.action === 'delete')
        addStat(stats, 'actualDeletedBytes', op.affectedBytes);
      if (!latest) continue;
      if (op.status === 'succeeded') {
        success = true;
        if (op.action === 'create') addStat(stats, 'succeededCreates');
        if (op.action === 'delete' && !op.isDir && op.reason === 'replace')
          addStat(stats, 'deletedForReplace');
        if (op.action === 'delete' && !op.isDir && op.reason === 'extra')
          addStat(stats, 'deletedAsExtra');
      } else if (
        ['failed', 'unknown', 'cancelled', 'skipped'].includes(op.status)
      ) {
        const key =
          op.status === 'failed'
            ? 'failedOperations'
            : op.status === 'unknown'
              ? 'unknownOperations'
              : op.status === 'cancelled'
                ? 'cancelledOperations'
                : 'skippedOperations';
        addStat(stats, key);
        if (op.errorCode !== 'PRECONDITION_ALREADY_ABSENT') {
          reasons.add(op.errorCode ?? 'DEPENDENCY_FAILED');
          if (op.status !== 'skipped') failed = true;
        }
      }
    }
  }
  return {
    target: {
      ...target,
      stats,
      extrasBlocked: reasons.size > 0,
      blockReasons: [...reasons],
    },
    success,
    failed,
    degraded: reasons.size > 0,
  };
}
/** 形成Run终态数据；调用方在同一终态事务写入各目标及Run。
 * @param db 数据库。
 * @param run Run扫描事实。
 * @returns 聚合状态、计数和目标更新。
 * @throws PlanError 数值溢出；Error 数据库失败。
 */
export function runResult(db: BetterSQLite3Database, run: RunRecord) {
  const targets = db
    .select()
    .from(runTargets)
    .where(eq(runTargets.runId, run.id))
    .all()
    .map(
      /** 按当前逻辑动作最后attempt聚合一个目标。
       * @param target 当前目标事实。
       * @returns 目标聚合结果。
       * @throws PlanError 计数溢出；Error 数据库失败。
       */
      (target) => targetResult(db, target),
    );
  const stats: Stats = { ...run.stats };
  for (const key of Object.keys(stats) as (keyof Stats)[]) {
    if (['sourceFiles', 'sourceDirectories', 'filteredFiles'].includes(key))
      continue;
    stats[key] = 0;
    for (const target of targets) addStat(stats, key, target.target.stats[key]);
  }
  const degraded = targets.some(
    /** 检测是否存在使Run降级的目标。
     * @param target 当前目标事实。
     * @returns 是否降级。
     * @throws 不适用。
     */
    (target) => target.degraded,
  );
  const success = targets.some(
    /** 检测至少一个成功动作或unchanged事实。
     * @param target 当前目标事实。
     * @returns 是否已有成功。
     * @throws 不适用。
     */
    (target) => target.success,
  );
  const failed = targets.some(
    /** 检测当前必要动作是否存在失败。
     * @param target 当前目标事实。
     * @returns 是否失败。
     * @throws 不适用。
     */
    (target) => target.failed,
  );
  const status = !degraded
    ? 'succeeded'
    : failed && !success
      ? 'failed'
      : 'partial';
  return {
    targets: targets.map(
      /** 提取应与Run终态一起保存的目标事实。
       * @param target 当前目标事实。
       * @returns 目标更新。
       * @throws 不适用。
       */
      (target) => target.target,
    ),
    stats,
    status,
  } as const;
}
