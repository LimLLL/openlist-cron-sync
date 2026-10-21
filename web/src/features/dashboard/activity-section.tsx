// 动态：进行中的运行在前（带呼吸光环），随后是最近结束的运行；以任务名为标题的编号行。
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import { IndexHead, IndexList, IndexRow } from '../../components/ui/index-list';
import { StatusDot } from '../../components/ui/status-dot';
import { formatRelative, formatTime } from '../../lib/format';
import { ACTIVE_RUN_STATES, runTone, useStatusLabels } from './status-labels';
import type { DashboardRun } from './dashboard-contract';

/** 活动区域属性。 */
interface ActivitySectionProps {
  /** 进行中的运行。 */
  activeRuns: DashboardRun[];
  /** 近期运行（含终态）。 */
  recentRuns: DashboardRun[];
  /** 任务 ID 到名称的映射。 */
  jobNames: ReadonlyMap<string, string>;
}

/** 渲染进行中与近期的运行。
 * @param props 运行列表与任务名称。
 * @returns 列表或空态。
 * @throws 不适用。
 */
export function ActivitySection({ activeRuns, recentRuns, jobNames }: ActivitySectionProps) {
  const { t } = useTranslation(['dashboard', 'common']);
  const labels = useStatusLabels();
  const activeIds = new Set(activeRuns.map((run) => run.id));
  const rows = [...activeRuns, ...recentRuns.filter((run) => !activeIds.has(run.id)).slice(0, 8)];

  if (rows.length === 0)
    return (
      <p className="flex items-center gap-3 border-y border-hairline px-1 py-6 text-sm text-muted-foreground">
        <StatusDot tone="muted" />
        {t('activity.empty')}
      </p>
    );

  return (
    <div>
      <IndexHead
        title={t('activity.columns.run')}
        cells={[t('activity.columns.trigger'), t('activity.columns.when')]}
        status={t('activity.columns.state')}
      />
      <IndexList>
        {rows.map((run, position) => {
          const live = ACTIVE_RUN_STATES.has(run.status);
          return (
            <IndexRow
              key={run.id}
              to={`/runs/${run.id}`}
              index={position + 1}
              title={jobNames.get(run.jobId) ?? t('activity.unknownJob')}
              subtitle={`${run.id.slice(0, 8)} · ${formatTime(live ? (run.startedAt ?? run.createdAt) : (run.endedAt ?? run.createdAt))}`}
              cells={[
                run.dryRun
                  ? `${t(`common:trigger.${run.trigger}`)} · ${t('common:dryRun')}`
                  : t(`common:trigger.${run.trigger}`),
                formatRelative(live ? (run.startedAt ?? run.createdAt) : (run.endedAt ?? run.createdAt)),
              ]}
              status={
                <Badge variant={runTone(run.status)} pulse={live}>
                  {labels.run(run.status)}
                </Badge>
              }
            />
          );
        })}
      </IndexList>
    </div>
  );
}
