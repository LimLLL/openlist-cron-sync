// 运行表格的共用单元格：耗时（进行中随时钟刷新）与结果摘要（正式运行看已完成、试运行看计划）。
import { useTranslation } from 'react-i18next';
import { useClock } from '../../components/text';
import { formatBytes, formatDuration } from '../../lib/format';
import { formatCount, runCounts, runDurationSeconds } from './run-format';
import type { RunView } from './run-contract';

/** 渲染运行耗时；进行中按共享时钟实时增长，未开始显示占位符。
 * @param props run 运行。
 * @returns 耗时文字。
 * @throws 不适用。
 */
export function RunDuration({
  run,
}: {
  run: Pick<RunView, 'startedAt' | 'endedAt' | 'status'>;
}) {
  // 订阅共享时钟：进行中的运行即使没有新数据也会定期重新计算耗时。
  useClock();
  const seconds = runDurationSeconds(run);
  return (
    <span className="tabular-nums">
      {seconds === null ? '—' : formatDuration(seconds)}
    </span>
  );
}

/** 渲染一行结果摘要：正式运行显示已新建/已删除/已传输，试运行显示计划量；失败操作用危险色标出。
 * @param props run 运行。
 * @returns 摘要文字；排队或扫描中没有计划时为占位符。
 * @throws 不适用。
 */
export function RunResultSummary({
  run,
}: {
  run: Pick<RunView, 'stats' | 'dryRun' | 'status'>;
}) {
  const { t } = useTranslation('runs');
  if (run.status === 'queued' || run.status === 'scanning')
    return <span className="text-muted-foreground">—</span>;
  const counts = runCounts(run.stats);
  const text = run.dryRun
    ? t('list.result.planned', {
        creates: formatCount(counts.plannedCreates),
        deletes: formatCount(counts.plannedDeletes),
        bytes: formatBytes(counts.plannedBytes),
      })
    : t('list.result.done', {
        creates: formatCount(counts.created),
        deletes: formatCount(counts.deleted),
        bytes: formatBytes(counts.transferred),
      });
  return (
    <span className="whitespace-nowrap text-muted-foreground">
      {text}
      {counts.failed > 0 && (
        <span className="ml-2 font-medium text-danger">
          {t('list.result.failed', { count: counts.failed })}
        </span>
      )}
    </span>
  );
}
