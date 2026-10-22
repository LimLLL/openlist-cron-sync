// 运营概览：编辑式页头、签名星图、统计条，以及“需要关注 / 动态 / 资源总览”三个编辑式分节。
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { ArrowUpRight, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/page-header';
import { Magnetic } from '../../components/motion/magnetic';
import { Button } from '../../components/ui/button';
import { EditorialSection } from '../../components/ui/editorial-section';
import { StatusDot } from '../../components/ui/status-dot';
import { ErrorState, LoadingState } from '../../components/states';
import { ObservatoryViz } from './observatory-viz';
import { StatStrip } from './stat-strip';
import { AttentionSection } from './attention-section';
import { ActivitySection } from './activity-section';
import { FleetSection } from './fleet-section';
import { Onboarding } from './onboarding';
import { failingJobIds } from './status-labels';
import {
  useActiveRuns,
  useAllInstances,
  useAllJobs,
  useHealth,
  useNextFireTimes,
  useRecentRuns,
  useUnresolvedOperations,
} from './dashboard-queries';

const EASE = [0.16, 1, 0.3, 1] as const;

/** 滚动进入视口时上浮淡入的分节容器。
 * @param props children 分节内容。
 * @returns 动画容器。
 * @throws 不适用。
 */
function Reveal({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.8, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** 渲染运营概览页。
 * @returns 概览页面。
 * @throws 不适用；请求错误在各分节内部显示。
 */
export function DashboardPage() {
  const { t } = useTranslation(['dashboard', 'common']);
  const recentRuns = useRecentRuns();
  const activeRuns = useActiveRuns();
  const unresolvedOps = useUnresolvedOperations();
  const instances = useAllInstances();
  const jobs = useAllJobs();
  const health = useHealth();

  const instanceItems = useMemo(
    () => instances.data?.items ?? [],
    [instances.data],
  );
  const jobItems = useMemo(() => jobs.data?.items ?? [], [jobs.data]);
  const recentItems = useMemo(
    () => recentRuns.data?.items ?? [],
    [recentRuns.data],
  );
  const scheduledJobIds = useMemo(
    () =>
      jobItems
        .filter((job) => job.enabled && job.cron)
        .slice(0, 6)
        .map((job) => job.id),
    [jobItems],
  );
  const nextFire = useNextFireTimes(scheduledJobIds);
  const failedRuns = useMemo(
    () =>
      recentItems.filter(
        (run) => run.status === 'failed' || run.status === 'partial',
      ),
    [recentItems],
  );
  const failing = useMemo(() => failingJobIds(recentItems), [recentItems]);
  const jobNames = useMemo(
    () => new Map(jobItems.map((job) => [job.id, job.name])),
    [jobItems],
  );

  const primaryError =
    instances.isError && jobs.isError && recentRuns.isError
      ? instances.error
      : null;
  const attentionError = unresolvedOps.error ?? recentRuns.error;
  const activityError = activeRuns.error ?? recentRuns.error;
  const fleetError = instances.error ?? jobs.error;
  const fleetLoaded = !instances.isPending && !jobs.isPending;
  const firstRun =
    fleetLoaded &&
    !fleetError &&
    instanceItems.length === 0 &&
    jobItems.length === 0;

  const systemMeta = health.data ? (
    <span className="inline-flex items-center gap-2">
      <StatusDot
        tone={health.data.status === 'ok' ? 'success' : 'warning'}
        pulse={health.data.status === 'ok'}
      />
      {health.data.status === 'ok' ? t('system.ok') : t('system.notReady')}
    </span>
  ) : health.isError ? (
    <span className="inline-flex items-center gap-2">
      <StatusDot tone="danger" />
      {t('system.unavailable')}
    </span>
  ) : (
    t('system.checking')
  );

  if (primaryError)
    return (
      <ErrorState
        error={primaryError}
        onRetry={() => {
          void instances.refetch();
          void jobs.refetch();
          void recentRuns.refetch();
        }}
      />
    );

  // 首次使用时插入引导分节，其余分节编号顺延。
  const number = (position: number) =>
    String(position + (firstRun ? 3 : 2)).padStart(2, '0');

  return (
    <div>
      <PageHeader
        index="01"
        kicker={t('common:nav.dashboard')}
        description={t('hero.description')}
        meta={systemMeta}
        actions={
          <>
            <Button asChild size="sm" variant="secondary">
              <Link to="/instances/new">
                <Plus size={15} aria-hidden="true" />
                {t('actions.newInstance')}
              </Link>
            </Button>
            <Magnetic>
              <Button asChild size="sm">
                <Link to="/jobs/new">
                  <Plus size={15} aria-hidden="true" />
                  {t('actions.newJob')}
                </Link>
              </Button>
            </Magnetic>
          </>
        }
      />

      <ObservatoryViz
        instances={instanceItems}
        jobs={jobItems}
        failing={failing}
      />

      <Reveal>
        {fleetError ? (
          <ErrorState error={fleetError} />
        ) : !fleetLoaded ? (
          <div className="border-y border-hairline py-8">
            <LoadingState label={t('loading.fleet')} rows={2} />
          </div>
        ) : (
          <StatStrip
            instances={instanceItems}
            jobs={jobItems}
            instanceTotal={instances.data?.total ?? 0}
            jobTotal={jobs.data?.total ?? 0}
            health={health.isError ? undefined : health.data}
            healthFailed={health.isError}
          />
        )}
      </Reveal>

      <div className="mt-16">
        {firstRun && (
          <Reveal>
            <EditorialSection
              index="02"
              title={t('onboarding.title')}
              description={t('onboarding.description')}
            >
              <Onboarding hasInstances={instanceItems.length > 0} />
            </EditorialSection>
          </Reveal>
        )}

        <Reveal>
          <EditorialSection
            index={number(0)}
            title={t('attention.title')}
            description={t('attention.scope', {
              shown: unresolvedOps.data?.items.length ?? 0,
              total: unresolvedOps.data?.total ?? 0,
            })}
          >
            {attentionError ? (
              <ErrorState error={attentionError} />
            ) : unresolvedOps.isPending || recentRuns.isPending ? (
              <LoadingState label={t('loading.attention')} />
            ) : (
              <AttentionSection
                failedRuns={failedRuns}
                unresolvedOps={unresolvedOps.data?.items ?? []}
                jobNames={jobNames}
              />
            )}
          </EditorialSection>
        </Reveal>

        <Reveal>
          <EditorialSection
            index={number(1)}
            title={t('activity.title')}
            description={t('activity.scope')}
            aside={
              <Link
                to="/runs"
                className="group inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-accent"
              >
                {t('activity.allRuns')}
                <ArrowUpRight
                  size={13}
                  className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            }
          >
            {activityError ? (
              <ErrorState error={activityError} />
            ) : activeRuns.isPending || recentRuns.isPending ? (
              <LoadingState label={t('loading.activity')} />
            ) : (
              <ActivitySection
                activeRuns={activeRuns.data ?? []}
                recentRuns={recentItems}
                jobNames={jobNames}
              />
            )}
          </EditorialSection>
        </Reveal>

        {!firstRun && (
          <Reveal>
            <EditorialSection
              index={number(2)}
              title={t('fleet.title')}
              description={
                <>
                  {t('fleet.description')}
                  {fleetLoaded &&
                    (instanceItems.length < (instances.data?.total ?? 0) ||
                      jobItems.length < (jobs.data?.total ?? 0)) && (
                      <span className="mt-2 block">
                        {t('fleet.partialScope', {
                          instancesShown: instanceItems.length,
                          instancesTotal: instances.data?.total ?? 0,
                          jobsShown: jobItems.length,
                          jobsTotal: jobs.data?.total ?? 0,
                        })}
                      </span>
                    )}
                </>
              }
            >
              {fleetError ? (
                <ErrorState error={fleetError} />
              ) : !fleetLoaded ? (
                <LoadingState label={t('loading.fleet')} />
              ) : (
                <FleetSection
                  instances={instanceItems}
                  jobs={jobItems}
                  scheduledJobIds={scheduledJobIds}
                  nextFireTimes={nextFire.data}
                  schedulesPending={nextFire.isPending}
                  scheduleError={nextFire.error}
                />
              )}
            </EditorialSection>
          </Reveal>
        )}
      </div>
    </div>
  );
}
