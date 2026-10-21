// 资源总览：左列是实例连接健康（编号行），右列是接下来的定时触发（大号等宽时间）。
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import { IndexList, IndexRow } from '../../components/ui/index-list';
import { ErrorState } from '../../components/states';
import { useErrorText } from '../../i18n/error-text';
import { formatRelative, formatTime } from '../../lib/format';
import { instanceHealth } from './status-labels';
import type { BadgeTone, InstanceHealth } from './status-labels';
import type { DashboardInstance, DashboardJob, NextFireTimes } from './dashboard-contract';

const VISIBLE_INSTANCES = 6;
const HEALTH_TONE: Record<InstanceHealth, BadgeTone> = {
  ready: 'success',
  blocked: 'warning',
  error: 'danger',
  untested: 'default',
};
const EASE = [0.16, 1, 0.3, 1] as const;

/** 资源总览属性。 */
interface FleetSectionProps {
  /** 已加载的实例。 */
  instances: DashboardInstance[];
  /** 已加载的任务。 */
  jobs: DashboardJob[];
  /** 查询下次触发的任务（启用中的定时任务，最多 6 个）。 */
  scheduledJobIds: string[];
  /** 按任务 ID 索引的下次触发。 */
  nextFireTimes: Map<string, NextFireTimes>;
  /** 下次触发是否仍在加载。 */
  schedulesPending: boolean;
  /** 下次触发查询的错误。 */
  scheduleError: Error | null;
}

/** 渲染小节标题与“查看全部”链接。
 * @param props title 标题；to 目标路由。
 * @returns 标题行。
 * @throws 不适用。
 */
function ColumnHeading({ title, to }: { title: string; to: string }) {
  const { t } = useTranslation('common');
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <h3 className="eyebrow">{title}</h3>
      <Link
        to={to}
        className="group inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {t('actions.viewAll')}
        <ArrowUpRight size={13} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

/** 渲染实例健康与下次触发两列。
 * @param props 实例、任务与定时数据。
 * @returns 两列布局。
 * @throws 不适用。
 */
export function FleetSection({
  instances,
  jobs,
  scheduledJobIds,
  nextFireTimes,
  schedulesPending,
  scheduleError,
}: FleetSectionProps) {
  const { t } = useTranslation(['dashboard', 'common']);
  const errorText = useErrorText();
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const healthLabel = (health: InstanceHealth) =>
    health === 'ready'
      ? t('fleet.authState.ready')
      : health === 'blocked'
        ? t('fleet.authState.auth_blocked')
        : health === 'error'
          ? t('fleet.healthError')
          : t('fleet.authState.untested');

  return (
    <div className="grid gap-12 2xl:grid-cols-2 2xl:gap-10">
      <div className="min-w-0">
        <ColumnHeading title={t('fleet.instancesTitle')} to="/instances" />
        {instances.length === 0 ? (
          <p className="border-y border-hairline px-1 py-6 text-sm text-muted-foreground">{t('fleet.noInstances')}</p>
        ) : (
          <>
            <IndexList className="border-t border-hairline">
              {instances.slice(0, VISIBLE_INSTANCES).map((instance, position) => {
                const health = instanceHealth(instance);
                return (
                  <IndexRow
                    key={instance.id}
                    to={`/instances/${instance.id}`}
                    index={position + 1}
                    title={instance.name}
                    subtitle={
                      instance.lastError
                        ? errorText(instance.lastError.code, instance.lastError.message)
                        : instance.lastTestAt
                          ? t('fleet.tested', { when: formatRelative(instance.lastTestAt) })
                          : t('fleet.neverTested')
                    }
                    status={<Badge variant={HEALTH_TONE[health]}>{healthLabel(health)}</Badge>}
                  />
                );
              })}
            </IndexList>
            {instances.length > VISIBLE_INSTANCES && (
              <p className="px-1 pt-3 font-mono text-[11px] text-muted-foreground">
                {t('fleet.more', { count: instances.length - VISIBLE_INSTANCES })}
              </p>
            )}
          </>
        )}
      </div>

      <div className="min-w-0">
        <ColumnHeading title={t('fleet.nextTimes')} to="/jobs" />
        {scheduleError ? (
          <ErrorState error={scheduleError} />
        ) : scheduledJobIds.length === 0 ? (
          <p className="border-y border-hairline px-1 py-6 text-sm text-muted-foreground">{t('fleet.noSchedules')}</p>
        ) : (
          <ol className="border-t border-hairline">
            {scheduledJobIds.map((jobId, position) => {
              const job = jobsById.get(jobId);
              const fire = nextFireTimes.get(jobId);
              const next = fire?.times[0];
              return (
                <motion.li
                  key={jobId}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: EASE, delay: position * 0.04 }}
                >
                  <Link
                    to={`/jobs/${jobId}`}
                    className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-hairline px-1 py-4 transition-colors hover:bg-white/[0.015]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-display text-[15px] font-medium tracking-tight transition-transform duration-500 group-hover:translate-x-1.5">
                        {job?.name ?? jobId}
                      </span>
                      <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
                        {job?.cron} · {fire?.timezone ?? job?.timezone}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono text-lg tracking-tight text-foreground tabular-nums">
                        {next
                          ? formatTime(next)
                          : fire
                            ? t('fleet.noUpcoming')
                            : schedulesPending
                              ? t('fleet.loading')
                              : t('fleet.unavailable')}
                      </span>
                      {next && (
                        <span className="mt-0.5 block font-mono text-[11px] text-accent">{formatRelative(next)}</span>
                      )}
                    </span>
                  </Link>
                </motion.li>
              );
            })}
          </ol>
        )}
        {scheduledJobIds.length > 0 && (
          <p className="px-1 pt-3 text-xs text-muted-foreground">{t('fleet.nextTimesScope')}</p>
        )}
      </div>
    </div>
  );
}
