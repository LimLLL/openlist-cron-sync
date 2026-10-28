// 概览页的派生计算：已用时间与各分区的排序筛选；不读取网络，便于复用与测试。
import { jobAttention } from '../jobs/job-health';
import type { JobListItem } from '../jobs/job-contract';

/** 计算两个时间点之间的秒数；结束为空时以 now 计（进行中）。
 * @param from 起始 ISO 时间；为空返回 null。
 * @param to 结束 ISO 时间；为空表示仍在进行。
 * @param now 当前毫秒时间戳。
 * @returns 非负整秒；时间非法返回 null。
 * @throws 不适用。
 */
export function elapsedSeconds(
  from: string | null,
  to: string | null,
  now: number,
): number | null {
  if (!from) return null;
  const start = Date.parse(from);
  const end = to ? Date.parse(to) : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

/** 需要处理的任务：按最近一次终态正式运行的结束时间倒序，定时错误（无运行）排在后面。
 * @param jobs 任务目录。
 * @returns 需要处理的任务及其原因。
 * @throws 不适用。
 */
export function attentionJobs(jobs: readonly JobListItem[]) {
  return jobs
    .map((job) => ({ job, reasons: jobAttention(job) }))
    .filter((entry) => entry.reasons.length > 0)
    .sort(
      (a, b) =>
        (b.job.latestTerminalRealRun?.endedAt ?? '').localeCompare(
          a.job.latestTerminalRealRun?.endedAt ?? '',
        ) || a.job.name.localeCompare(b.job.name),
    );
}

/** 按下次定时时间升序取前若干个未归档任务。
 * @param jobs 任务目录。
 * @param limit 数量上限（展示用，不影响数据加载）。
 * @returns 有下次定时时间的任务。
 * @throws 不适用。
 */
export function upcomingJobs(
  jobs: readonly JobListItem[],
  limit: number,
): Array<JobListItem & { nextFireAt: string }> {
  return jobs
    .filter(
      (job): job is JobListItem & { nextFireAt: string } =>
        !job.archivedAt && job.nextFireAt !== null,
    )
    .sort((a, b) => Date.parse(a.nextFireAt) - Date.parse(b.nextFireAt))
    .slice(0, limit);
}
