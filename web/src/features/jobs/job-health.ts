// 任务“需要处理”的唯一判定：只看最近一次终态正式运行（试运行不算）与定时诊断；概览与任务列表共用。
import type { JobListItem, TerminalRealRunSummary } from './job-contract';

/** 需要处理的原因。 */
export type AttentionReason =
  'failed' | 'partial' | 'interrupted' | 'timeout' | 'scheduleError';

/** 判断最近一次终态正式运行是否需要处理。
 * 失败、部分成功、中断、超时取消需要处理；成功、用户主动取消与从未完成正式运行不需要。
 * @param run 最近一次终态正式运行摘要。
 * @returns 原因；不需要处理为 null。
 * @throws 不适用。
 */
export function runAttention(
  run: TerminalRealRunSummary | null,
): Exclude<AttentionReason, 'scheduleError'> | null {
  if (!run) return null;
  if (run.status === 'failed') return 'failed';
  if (run.status === 'partial') return 'partial';
  if (run.status === 'interrupted') return 'interrupted';
  // 原因未知的取消不推断为超时，也不算需要处理。
  if (run.status === 'cancelled' && run.stopReason === 'RUN_TIMEOUT')
    return 'timeout';
  return null;
}

/** 列出任务需要处理的全部原因；归档任务不参与。
 * @param job 任务列表项。
 * @returns 原因数组，空数组表示正常。
 * @throws 不适用。
 */
export function jobAttention(job: JobListItem): AttentionReason[] {
  if (job.archivedAt) return [];
  const reasons: AttentionReason[] = [];
  const run = runAttention(job.latestTerminalRealRun);
  if (run) reasons.push(run);
  if (job.scheduleError) reasons.push('scheduleError');
  return reasons;
}
