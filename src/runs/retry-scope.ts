// 从历史最后attempt或独立范围提取重试意图；不重放旧计划，也不读取远端。
import { and, desc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { runs } from '../database/run-schema.js';
import type { RunRecord } from '../database/run-schema.js';
import { jobs } from '../database/job-schema.js';
import { jobRecords, jobView } from '../database/job-records.js';
import { jobBusy } from '../database/responsibility.js';
import { containsPath } from '../openlist/paths.js';
import { TERMINAL_RUNS } from './run-finalizer.js';

/** 稳定Target内的文件或目录意图，路径不含根前缀。 */
export interface RetryCandidate {
  /** Job Target ID，不是旧RunTarget ID。 */
  targetId: string;
  /** 空字符串仅表示端点根目录自身。 */
  relativePath: string;
  /** true仅重试此目录自身，不展开子树。 */
  isDir: boolean;
}
/** 重试不可用的确定原因，不混入队列和服务就绪瞬时错误。 */
export const RETRY_REASONS = [
  'RUN_NOT_TERMINAL',
  'DRY_RUN',
  'HISTORY_EXPIRED',
  'JOB_ARCHIVED',
  'JOB_BUSY',
  'RUN_SUPERSEDED',
  'SOURCE_ENDPOINT_CHANGED',
  'NO_RETRY_ITEMS',
] as const;
/** 运行详情的资格和候选数量；数量不是将执行的Operation数。 */
export interface RetryEligibility {
  /** 满足当前业务资格；POST仍会事务内复查。 */
  eligible: boolean;
  /** 不可用原因；可用时为null。 */
  reason: (typeof RETRY_REASONS)[number] | null;
  /** 排除目标变更后的文件意图数。 */
  candidateFiles: number;
  /** 排除目标变更后的目录意图数。 */
  candidateDirectories: number;
  /** 因目标移除或instanceId/path变化排除的意图数。 */
  excludedItems: number;
}
/** 查询候选并规范化旧目标路径；SQL只物化本轮最后attempt及候选。
 * @param db 数据库或接受事务。
 * @param run 待重试的历史Run。
 * @returns 按Target和原路径去重的意图。
 * @throws Error 历史路径不属于目标根或数据库失败。
 */
export function retryCandidates(
  db: BetterSQLite3Database,
  run: RunRecord,
): RetryCandidate[] {
  const latest = sql`WITH latest AS MATERIALIZED (
    SELECT o.run_target_id,o.target_path,o.is_dir,o.action,o.reason,o.status FROM operations o WHERE o.run_id=${run.id}
      AND o.error_code IS NOT 'REMOTE_TASK_CHANGED'
      AND o.reason != 'retry_cleanup'
      AND NOT EXISTS (SELECT 1 FROM operations newer
        WHERE newer.retry_of=coalesce(o.retry_of,o.id)
        AND newer.run_id=o.run_id AND newer.target_path=o.target_path
        AND newer.error_code IS NOT 'REMOTE_TASK_CHANGED' AND newer.reason!='retry_cleanup'
        AND newer.attempt_no>o.attempt_no)
  ), intents AS (
    SELECT run_target_id,target_path,is_dir,
      max(CASE WHEN action IN ('create','mkdir') AND status='succeeded' THEN 1 ELSE 0 END) AS succeeded,
      max(CASE WHEN status!='succeeded' THEN 1 ELSE 0 END) AS unfinished
    FROM latest WHERE action IN ('create','mkdir') OR (action='delete' AND reason='replace')
    GROUP BY run_target_id,target_path,is_dir
  )`;
  const rows = db.all<{
    targetId: string;
    root: string;
    path: string;
    isDir: number;
    relative: string | null;
  }>(
    run.retryOfRunId === null
      ? sql`${latest} SELECT t.target_id AS targetId,json_extract(t.target_snapshot_json,'$.target.path') AS root,
          i.target_path AS path,i.is_dir AS isDir,NULL AS relative
        FROM intents i JOIN run_targets t ON t.id=i.run_target_id
        WHERE i.succeeded=0 AND i.unfinished=1 ORDER BY t.target_id,i.target_path`
      : sql`${latest} SELECT t.target_id AS targetId,json_extract(t.target_snapshot_json,'$.target.path') AS root,
          '' AS path,s.is_dir AS isDir,s.relative_path AS relative
        FROM run_retry_items s JOIN run_targets t ON t.id=s.run_target_id
        WHERE s.run_id=${run.id} AND s.scan_outcome!='noop'
          AND (s.scan_outcome!='planned' OR NOT EXISTS (
            SELECT 1 FROM intents i WHERE i.run_target_id=s.run_target_id AND i.is_dir=s.is_dir AND i.succeeded=1
              AND i.target_path=CASE WHEN s.relative_path='' THEN json_extract(t.target_snapshot_json,'$.target.path')
                ELSE rtrim(json_extract(t.target_snapshot_json,'$.target.path'),'/') || '/' || s.relative_path END))
        ORDER BY t.target_id,s.relative_path`,
  );
  return rows.map(
    /** 将绝对历史路径转换为同一目标根下的相对意图。
     * @param row 候选行。
     * @returns 不含旧操作执行事实的输入。
     * @throws Error 旧路径超出根范围。
     */
    (row) => {
      if (row.relative === null && !containsPath(row.root, row.path))
        throw new Error('Retry path outside target root');
      return {
        targetId: row.targetId,
        relativePath:
          row.relative ??
          (row.path === row.root
            ? ''
            : row.path.slice(row.root === '/' ? 1 : row.root.length + 1)),
        isDir: row.isDir === 1,
      };
    },
  );
}
/** 计算资格；过期历史可能正在分批删除，必须先拒绝再读候选。
 * @param db 当前数据库或事务。
 * @param run 父Run。
 * @param retentionDays 当前历史保留天数。
 * @param now 本次资格检查的UTC毫秒。
 * @returns 公共摘要与仅供接受事务使用的候选。
 * @throws Error 数据库失败。
 */
export function retrySelection(
  db: BetterSQLite3Database,
  run: RunRecord,
  retentionDays: number,
  now = Date.now(),
) {
  const summary: RetryEligibility = {
    eligible: false,
    reason: null,
    candidateFiles: 0,
    candidateDirectories: 0,
    excludedItems: 0,
  };
  const candidates: RetryCandidate[] = [];
  if (!TERMINAL_RUNS.includes(run.status)) summary.reason = 'RUN_NOT_TERMINAL';
  else if (run.dryRun) summary.reason = 'DRY_RUN';
  else if (run.endedAt === null || run.endedAt < now - retentionDays * 86400000)
    summary.reason = 'HISTORY_EXPIRED';
  else {
    const jobRow = db.select().from(jobs).where(eq(jobs.id, run.jobId)).get();
    if (!jobRow || jobRow.archivedAt !== null) summary.reason = 'JOB_ARCHIVED';
    else if (jobBusy(db, run.jobId)) summary.reason = 'JOB_BUSY';
    else {
      const latest = db
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.jobId, run.jobId), eq(runs.dryRun, false)))
        .orderBy(desc(runs.createdAt), desc(runs.id))
        .limit(1)
        .get();
      if (latest?.id !== run.id) summary.reason = 'RUN_SUPERSEDED';
      else {
        const { row, targets } = jobRecords(db, run.jobId);
        const job = jobView(row, targets);
        if (
          job.source.instanceId !== run.config.job.source.instanceId ||
          job.source.path !== run.config.job.source.path
        )
          summary.reason = 'SOURCE_ENDPOINT_CHANGED';
        else {
          const matching = new Set(
            job.targets
              .filter(
                /** 保留相同稳定ID、实例及根路径的目标。
                 * @param target 当前目标。
                 * @returns 是否仍指向父Run中的端点。
                 * @throws 不适用。
                 */
                (target) =>
                  run.config.job.targets.some(
                    (old) =>
                      old.id === target.id &&
                      old.instanceId === target.instanceId &&
                      old.path === target.path,
                  ),
              )
              .map((target) => target.id),
          );
          for (const candidate of retryCandidates(db, run)) {
            if (!matching.has(candidate.targetId)) {
              summary.excludedItems++;
              continue;
            }
            candidates.push(candidate);
            if (candidate.isDir) summary.candidateDirectories++;
            else summary.candidateFiles++;
          }
          summary.reason = candidates.length ? null : 'NO_RETRY_ITEMS';
          summary.eligible = summary.reason === null;
        }
      }
    }
  }
  return { summary, candidates };
}
