// 按逻辑动作最后attempt聚合执行结果，传输字节仍累计全部尝试。
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { operations } from '../database/operation-schema.js';
import { runTargets } from '../database/run-schema.js';
import type { RunRecord, RunTargetRecord } from '../database/run-schema.js';
import { addStat, PlanError } from './stats.js';
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
};
/** 一次SQL聚合活动Run的执行统计，口径与终态targetResult相同。
 * 逻辑动作只看最后attempt（判定式与targetResult一致），字节与重试次数累计全部attempt；
 * 应用层只合并每个Target一行结果，不逐行遍历操作。
 * @param db 数据库。
 * @param run 活动Run。
 * @returns 带实时统计与阻断原因的Run Target，以及Run汇总统计。
 * @throws PlanError RESOURCE_LIMIT 聚合超出安全整数；Error 数据库失败。
 */
export function liveRunResult(db: BetterSQLite3Database, run: RunRecord) {
  let rows: LiveRow[];
  try {
    rows = db.all<LiveRow>(sql`
      WITH attempts AS MATERIALIZED (
        SELECT
          o.run_target_id, o.seq, o.status, o.action, o.reason, o.is_dir,
          o.retry_of, o.error_code, o.bytes_downloaded, o.bytes_transferred,
          o.affected_bytes,
          -- 与targetResult相同的最后attempt判定；按retry_of索引查找，避免路径索引扫描历史Run。
          NOT EXISTS (
            SELECT 1 FROM operations AS newer INDEXED BY operations_retry_of
            WHERE newer.target_instance_id = o.target_instance_id
              AND newer.target_path = o.target_path
              AND newer.run_id = o.run_id
              AND newer.retry_of = coalesce(o.retry_of, o.id)
              AND newer.attempt_no > o.attempt_no
          ) AS latest
        FROM operations AS o
        WHERE o.run_id = ${run.id} AND o.caused_by_operation_id IS NULL
      ),
      reasons AS MATERIALIZED (
        SELECT run_target_id, coalesce(error_code, 'DEPENDENCY_FAILED') AS code, min(seq) AS first_seq
        FROM attempts
        WHERE latest
          AND status IN ('failed', 'unknown', 'cancelled', 'skipped')
          AND error_code IS NOT 'PRECONDITION_ALREADY_ABSENT'
        GROUP BY run_target_id, code
      )
      SELECT
        run_target_id AS runTargetId,
        sum(CASE WHEN latest AND status = 'succeeded' AND action = 'create' THEN 1 ELSE 0 END) AS succeededCreates,
        sum(CASE WHEN latest AND status = 'succeeded' AND action = 'delete' AND NOT is_dir AND reason = 'replace' THEN 1 ELSE 0 END) AS deletedForReplace,
        sum(CASE WHEN latest AND status = 'succeeded' AND action = 'delete' AND NOT is_dir AND reason = 'extra' THEN 1 ELSE 0 END) AS deletedAsExtra,
        sum(CASE WHEN latest AND status = 'failed' THEN 1 ELSE 0 END) AS failedOperations,
        sum(CASE WHEN latest AND status = 'unknown' THEN 1 ELSE 0 END) AS unknownOperations,
        sum(CASE WHEN latest AND status = 'skipped' THEN 1 ELSE 0 END) AS skippedOperations,
        sum(CASE WHEN latest AND status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledOperations,
        sum(retry_of IS NOT NULL) AS retryAttempts,
        sum(bytes_downloaded) AS downloadedBytes,
        sum(bytes_transferred) AS transferredBytes,
        sum(CASE WHEN status = 'succeeded' AND action = 'delete' THEN affected_bytes ELSE 0 END) AS actualDeletedBytes,
        (
          SELECT json_group_array(code) FROM (
            SELECT code FROM reasons AS r
            WHERE r.run_target_id = attempts.run_target_id
            ORDER BY first_seq, code
          )
        ) AS blockReasons
      FROM attempts
      GROUP BY run_target_id
    `);
  } catch (error) {
    // SQLite整数求和溢出时报integer overflow，按addStat的口径转为资源上限。
    if (error instanceof Error && /integer overflow/i.test(error.message))
      throw new PlanError('RESOURCE_LIMIT');
    throw error;
  }
  const live = new Map(
    rows.map(
      /** 转为Run Target ID与聚合行的映射条目。
       * @param row 聚合行。
       * @returns 映射条目。
       * @throws 不适用。
       */
      (row) => [row.runTargetId, row],
    ),
  );
  const targets = db
    .select()
    .from(runTargets)
    .where(eq(runTargets.runId, run.id))
    .all()
    .map(
      /** 用聚合行覆盖一个Target的执行统计，阻断原因追加在已落库原因之后。
       * @param target 当前目标事实。
       * @returns 带实时统计的目标。
       * @throws PlanError 统计超出安全整数。
       */
      (target): RunTargetRecord => {
        const row = live.get(target.id);
        const stats: Stats = { ...target.stats };
        for (const key of LIVE_KEYS) {
          stats[key] = 0;
          addStat(stats, key, Number(row?.[key] ?? 0));
        }
        const reasons = new Set(target.blockReasons);
        for (const reason of JSON.parse(row?.blockReasons ?? '[]') as string[])
          reasons.add(reason);
        return {
          ...target,
          stats,
          extrasBlocked: reasons.size > 0,
          blockReasons: [...reasons],
        };
      },
    );
  const stats: Stats = { ...run.stats };
  for (const key of Object.keys(stats) as (keyof Stats)[]) {
    if (['sourceFiles', 'sourceDirectories', 'filteredFiles'].includes(key))
      continue;
    stats[key] = 0;
    for (const target of targets) addStat(stats, key, target.stats[key]);
  }
  return { targets, stats };
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
        and(
          eq(operations.runTargetId, target.id),
          gt(operations.seq, after),
          isNull(operations.causedByOperationId),
        ),
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
