// 任务详情的“最近运行”分节：编号行链接到运行详情，进行中的运行自动刷新。
import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EditorialSection } from '../../components/ui/editorial-section';
import { IndexHead, IndexList, IndexRow } from '../../components/ui/index-list';
import { Badge } from '../../components/ui/badge';
import { ErrorState, LoadingState } from '../../components/states';
import { formatDuration, formatRelative, formatTime } from '../../lib/format';
import { runBadge, useJobRuns } from './job-runs';
import type { JobRun } from './job-runs';

/** 计算运行耗时秒数；尚未开始时为 null，进行中按当前时间计算。
 * @param run 运行摘要。
 * @returns 秒数或 null。
 * @throws 不适用。
 */
function durationOf(run: JobRun): number | null {
  if (!run.startedAt) return null;
  const end = run.endedAt ? Date.parse(run.endedAt) : Date.now();
  return Math.max(0, Math.round((end - Date.parse(run.startedAt)) / 1000));
}

/** 渲染最近运行分节。
 * @param props jobId 任务 UUID；index 分节编号。
 * @returns 分节。
 * @throws 不适用。
 */
export function RecentRunsSection({ jobId, index }: { jobId: string; index: string }) {
  const { t } = useTranslation(['jobs', 'common']);
  const runs = useJobRuns(jobId);
  return (
    <EditorialSection
      index={index}
      title={t('detail.recentRuns')}
      description={t('detail.recentRunsDesc')}
      aside={
        <Link
          to={`/runs?jobId=${jobId}`}
          className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
        >
          {t('detail.viewAllRuns')}
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      }
    >
      {runs.isPending ? (
        <LoadingState rows={4} />
      ) : runs.isError ? (
        <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
      ) : runs.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('detail.recentEmpty')}</p>
      ) : (
        <>
          <IndexHead
            title={t('detail.colRun')}
            cells={[t('detail.colTrigger'), t('detail.colStarted'), t('detail.colDuration')]}
            status={t('list.colState')}
          />
          <IndexList>
            {runs.data.items.map((run, position) => {
              const badge = runBadge(run.status);
              const seconds = durationOf(run);
              return (
                <IndexRow
                  key={run.id}
                  to={`/runs/${run.id}`}
                  index={position + 1}
                  title={run.dryRun ? t('common:dryRun') : t('common:realRun')}
                  subtitle={`${run.id.slice(0, 8)} · ${formatRelative(run.createdAt)}`}
                  cells={[
                    t(`common:trigger.${run.trigger}`),
                    formatTime(run.startedAt),
                    seconds === null ? '—' : formatDuration(seconds),
                  ]}
                  status={
                    <Badge variant={badge.variant} pulse={badge.pulse}>
                      {t(`common:runStatus.${run.status}`)}
                    </Badge>
                  }
                />
              );
            })}
          </IndexList>
        </>
      )}
    </EditorialSection>
  );
}
