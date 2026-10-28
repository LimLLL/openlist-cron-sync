// 列表专用运行摘要；不扩展Job配置或运行快照，也不读取实时统计。
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { jobs } from '../database/job-schema.js';
import { runs } from '../database/run-schema.js';
import { time } from '../database/job-records.js';
import { retryOrigin } from '../runs/views.js';
import { TERMINAL_RUNS } from '../runs/run-finalizer.js';
import type { ACTIVE_RUN_STATUSES, RunStatus } from '../runs/run-types.js';
import type { SchedulePreview } from '../scheduling/cron-time.js';
import type { Job } from './job-types.js';

/** 最新终态真实运行的公共摘要；无统计或配置内容。 */
export interface TerminalRealRunSummary {
  /** Run UUID。 */
  id: string;
  /** 重试来源；普通Run为null。 */
  retryOfRunId: string | null;
  /** 来源历史仍存在；普通Run为false。 */
  retrySourceExists: boolean;
  /** 仅终态，不含active查询简写或活动状态。 */
  status: Exclude<RunStatus, (typeof ACTIVE_RUN_STATUSES)[number]>;
  /** 接受UTC时刻，也是最新运行排序依据。 */
  createdAt: string;
  /** 扫描开始UTC时刻；从未开始为null。 */
  startedAt: string | null;
  /** 终态UTC时刻，由数据库终态约束保证存在。 */
  endedAt: string;
  /** 沿用Run的停止原因；正常完成或普通失败为null。 */
  stopReason: string | null;
  /** Run级错误；终态失败或partial也可能没有该错误。 */
  error: { code: string; message: string } | null;
}

/** Job列表响应；基础配置仍使用未扩展的Job类型。 */
export interface JobListItem extends Job, SchedulePreview {
  /** 按createdAt/id倒序的最新终态非预览运行；没有则为null。 */
  latestTerminalRealRun: TerminalRealRunSummary | null;
}

/** 按当前页Job批量读取最新终态真实运行，只投影列表所需列。
 * @param db 当前数据库。
 * @param jobIds 已完成分页的Job ID集合。
 * @returns Job ID到运行摘要的映射；无符合条件运行的Job不出现。
 * @throws Error 数据库读取失败；RangeError 持久化时间非法。
 */
export function latestTerminalRealRuns(
  db: BetterSQLite3Database,
  jobIds: string[],
): Map<string, TerminalRealRunSummary> {
  if (jobIds.length === 0) return new Map();
  // 每个当前页Job只按既有(job_id, created_at, id)索引向后找一条；不联接目标或扫描全部历史。
  const latestId = db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.jobId, jobs.id),
        eq(runs.dryRun, false),
        inArray(runs.status, TERMINAL_RUNS),
      ),
    )
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(1);
  const rows = db
    .select({
      jobId: jobs.id,
      id: runs.id,
      retryOfRunId: runs.retryOfRunId,
      status: runs.status,
      createdAt: runs.createdAt,
      startedAt: runs.startedAt,
      endedAt: runs.endedAt,
      stopReason: runs.stopReason,
      errorCode: runs.errorCode,
      errorMessage: runs.errorMessage,
    })
    .from(jobs)
    .innerJoin(runs, eq(runs.id, latestId))
    .where(inArray(jobs.id, jobIds))
    .all();
  return new Map(
    rows.map(
      /** 将筛选出的终态记录转换为固定公共形状。
       * @param row 当前Job的终态真实运行。
       * @returns Job ID与摘要条目。
       * @throws RangeError 持久化时间非法。
       */
      (row): [string, TerminalRealRunSummary] => [
        row.jobId,
        {
          id: row.id,
          ...retryOrigin(db, row.retryOfRunId),
          // SQL限制终态，runs_terminal CHECK保证endedAt非空。
          status: row.status as TerminalRealRunSummary['status'],
          createdAt: new Date(row.createdAt).toISOString(),
          startedAt: time(row.startedAt),
          endedAt: new Date(row.endedAt!).toISOString(),
          stopReason: row.stopReason,
          error:
            row.errorCode === null
              ? null
              : {
                  code: row.errorCode,
                  message: row.errorMessage ?? row.errorCode,
                },
        },
      ],
    ),
  );
}
