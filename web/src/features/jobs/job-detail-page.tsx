// 任务详情：头部（名称、定时状态、运行/编辑/更多操作）、一行关键信息，以及“运行记录 / 配置”两个 URL 标签页。
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Pencil, Play } from 'lucide-react';
import { FactStrip, PageHeader, useDocumentTitle } from '../../components/page';
import { ErrorState, LoadingState, StaleNotice } from '../../components/states';
import { Endpoint, RelativeTime } from '../../components/text';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../components/ui/tabs';
import { Tip } from '../../components/ui/tooltip';
import { useErrorText } from '../../i18n/error-text';
import { ApiError } from '../../lib/api-client';
import { useTabParam } from '../../lib/hooks';
import { activeRunsByJob, useActiveRuns } from '../runs/run-queries';
import { JobActionsMenu } from './job-actions';
import { JobConfigTab } from './job-detail-config';
import { JobRunsTab } from './job-detail-runs';
import { ActiveRunLink, LastRealRun, useInstanceName } from './job-display';
import { useJob, useJobCatalog, useNextFireTimes } from './job-queries';
import { JobTriggerDialog } from './job-trigger-dialog';
import type { JobView } from './job-contract';

const TABS = ['runs', 'config'] as const;

/** 渲染定时状态徽标。
 * @param props job 任务。
 * @returns 徽标。
 * @throws 不适用。
 */
function ScheduleBadge({ job }: { job: Pick<JobView, 'cron' | 'enabled'> }) {
  const { t } = useTranslation('jobs');
  if (!job.cron) return <Badge>{t('badge.manual')}</Badge>;
  return job.enabled ? (
    <Badge tone="success" dot>
      {t('badge.scheduleOn')}
    </Badge>
  ) : (
    <Badge>{t('badge.scheduleOff')}</Badge>
  );
}

/** 渲染任务详情页。
 * @returns 详情页。
 * @throws 不适用；请求错误在页面内显示。
 */
export function JobDetailPage() {
  const { t } = useTranslation(['jobs', 'common']);
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const job = useJob(id);
  const catalog = useJobCatalog({ poll: true });
  const activeRuns = useActiveRuns();
  const instanceName = useInstanceName();
  const [tab, setTab] = useTabParam('tab', TABS, 'runs');
  const [trigger, setTrigger] = useState<{ dryRun: boolean } | null>(null);
  const data = job.data;
  const nextFire = useNextFireTimes(id, Boolean(data?.cron && data.enabled));
  const active = useMemo(
    () => activeRunsByJob(activeRuns.data).get(id),
    [activeRuns.data, id],
  );
  const item = catalog.data?.find((entry) => entry.id === id);
  useDocumentTitle(data?.name, t('list.title'));

  if (!data && !job.isError)
    return <LoadingState label={t('detail.loading')} rows={6} />;
  if (!data)
    return (
      <div className="space-y-3">
        <ErrorState
          error={job.error!}
          onRetry={
            job.error instanceof ApiError && job.error.status === 404
              ? undefined
              : () => {
                  void job.refetch();
                }
          }
        />
        <Button asChild>
          <Link to="/jobs">{t('detail.notFound')}</Link>
        </Button>
      </div>
    );

  const current = data;
  const busy = active !== undefined || activeRuns.data === undefined;
  const busyReason = active
    ? t('list.runBusy')
    : t('common:states.activityUnknown');
  const nextTime = nextFire.data?.times[0] ?? item?.nextFireAt ?? null;

  return (
    <section>
      <PageHeader
        back={{ to: '/jobs', label: t('detail.back') }}
        title={current.name}
        badges={<ScheduleBadge job={current} />}
        description={
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <Endpoint
              instance={instanceName(current.source.instanceId)}
              path={current.source.path}
            />
            <span>
              {t('detail.summary', { count: current.targets.length })}
            </span>
          </span>
        }
        actions={
          <>
            <Tip content={busy ? busyReason : null}>
              <span tabIndex={busy ? 0 : undefined}>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => setTrigger({ dryRun: false })}
                >
                  <Play size={14} aria-hidden="true" />
                  {t('actions.run')}
                </Button>
              </span>
            </Tip>
            {busy ? (
              <Tip content={busyReason}>
                <span tabIndex={0}>
                  <Button disabled>
                    <Pencil size={14} aria-hidden="true" />
                    {t('actions.edit')}
                  </Button>
                </span>
              </Tip>
            ) : (
              <Button asChild>
                <Link to={`/jobs/${current.id}/edit`}>
                  <Pencil size={14} aria-hidden="true" />
                  {t('actions.edit')}
                </Link>
              </Button>
            )}
            <JobActionsMenu
              job={current}
              busy={busy}
              showNavigation={false}
              onDryRun={() => setTrigger({ dryRun: true })}
              onArchived={() => navigate('/jobs')}
            />
          </>
        }
      />

      <StaleNotice show={job.isRefetchError || catalog.isRefetchError} />
      {activeRuns.error && (
        <ErrorState
          error={activeRuns.error}
          onRetry={() => void activeRuns.refetch()}
          compact
        />
      )}
      <FactStrip
        facts={[
          {
            label: t('detail.facts.current'),
            value: active ? (
              <ActiveRunLink run={active} />
            ) : (
              <span className="text-muted-foreground">
                {activeRuns.data
                  ? t('detail.idle')
                  : t('common:states.activityUnknown')}
              </span>
            ),
          },
          {
            label: t('detail.facts.lastRun'),
            value: item ? (
              <LastRealRun run={item.latestTerminalRealRun} />
            ) : (
              '—'
            ),
          },
          {
            label: t('detail.facts.nextRun'),
            value: item?.scheduleError ? (
              <span className="text-danger">
                {errorText(item.scheduleError.code, item.scheduleError.message)}
              </span>
            ) : current.cron && current.enabled ? (
              <RelativeTime iso={nextTime} />
            ) : (
              '—'
            ),
          },
          {
            label: t('detail.facts.schedule'),
            value: current.cron ? (
              <span>
                <span translate="no" className="font-mono text-[12.5px]">
                  {current.cron}
                </span>
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {current.timezone}
                </span>
              </span>
            ) : (
              t('list.manualOnly')
            ),
          },
          {
            label: t('detail.facts.targets'),
            value: current.targets.length,
          },
          {
            label: t('detail.facts.created'),
            value: <RelativeTime iso={current.createdAt} />,
          },
        ]}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="runs">{t('detail.tabs.runs')}</TabsTrigger>
          <TabsTrigger value="config">{t('detail.tabs.config')}</TabsTrigger>
        </TabsList>
        <TabsContent value="runs">
          <JobRunsTab jobId={current.id} />
        </TabsContent>
        <TabsContent value="config">
          <JobConfigTab
            job={current}
            instanceName={instanceName}
            nextFire={nextFire}
          />
        </TabsContent>
      </Tabs>

      <JobTriggerDialog
        job={trigger ? current : null}
        initialDryRun={trigger?.dryRun ?? false}
        onClose={() => setTrigger(null)}
      />
    </section>
  );
}
