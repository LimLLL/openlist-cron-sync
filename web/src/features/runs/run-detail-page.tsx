// 运行详情：页头（状态、取消、查看任务）、停止原因、生命周期横条、关键计数，以及写进 URL 的操作/问题/目标/统计/配置标签页。
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FactStrip, PageHeader, useDocumentTitle } from '../../components/page';
import {
  ButtonSkeleton,
  LineSkeleton,
  Skeleton,
  SkeletonRegion,
  skeletonFacts,
  TitleSkeleton,
} from '../../components/skeleton';
import { ErrorState, LoadingState } from '../../components/states';
import { RunStatusBadge } from '../../components/status';
import { RelativeTime, ShortId } from '../../components/text';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../components/ui/tabs';
import { useTabParam } from '../../lib/hooks';
import { isActiveRun, useCancelRun, useRun } from './run-queries';
import { hasPlannedWork, snapshotJobName } from './run-format';
import { RunLifecycle, RunLifecycleSkeleton } from './run-lifecycle';
import { RunErrorBanner, RunFacts } from './run-summary';
import {
  OperationSheet,
  RunOperationsSkeleton,
  RunOperationsTab,
} from './run-operations-tab';
import { RunIssuesSkeleton, RunIssuesTab } from './run-issues-tab';
import { RunTargets } from './run-targets';
import { RunConfigTab, RunStatsTab } from './run-stats-tab';
import type { RunDetail } from './run-contract';

const TABS = ['operations', 'issues', 'targets', 'stats', 'snapshot'] as const;

/** 取消运行按钮与确认框；只在运行进行中且尚未请求取消时显示。
 * @param props run 运行详情。
 * @returns 按钮与确认框，或 null。
 * @throws 不适用；请求错误在确认框内显示。
 */
function CancelRunButton({ run }: { run: RunDetail }) {
  const { t } = useTranslation('runs');
  const cancel = useCancelRun();
  const [open, setOpen] = useState(false);
  if (!isActiveRun(run.status) || run.cancelRequestedAt) return null;
  return (
    <>
      <Button
        onClick={() => {
          cancel.reset();
          setOpen(true);
        }}
      >
        {t('detail.cancel')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('detail.cancelTitle')}
        description={t('detail.cancelDescription')}
        confirmLabel={t('detail.cancelConfirm')}
        pending={cancel.isPending}
        error={cancel.error}
        onConfirm={() =>
          cancel.mutate(run.id, { onSuccess: () => setOpen(false) })
        }
      />
    </>
  );
}

/** 渲染已加载的运行详情。
 * @param props run 运行详情；stale 最近一次刷新是否失败。
 * @returns 运行详情内容。
 * @throws 不适用。
 */
function RunDetailView({ run, stale }: { run: RunDetail; stale: boolean }) {
  const { t } = useTranslation(['runs', 'common']);
  // 默认标签只在进入页面时确定一次，避免轮询中计数变化导致标签跳动。
  const [fallback] = useState<(typeof TABS)[number]>(() =>
    run.issueCount > 0 && !hasPlannedWork(run.stats) ? 'issues' : 'operations',
  );
  const [tab, setTab] = useTabParam('tab', TABS, fallback);
  const name =
    snapshotJobName(run) ?? t('detail.untitled', { id: run.id.slice(0, 8) });

  return (
    <section>
      <PageHeader
        title={name}
        badges={
          <>
            <RunStatusBadge status={run.status} stopReason={run.stopReason} />
            {run.dryRun && <Badge>{t('common:dryRun')}</Badge>}
          </>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {t(`detail.trigger.${run.trigger}`)}
            <span aria-hidden="true">·</span>
            {t('detail.createdAt')} <RelativeTime iso={run.createdAt} />
            <span aria-hidden="true">·</span>
            <ShortId id={run.id} />
          </span>
        }
        back={{ to: '/runs', label: t('common:nav.runs') }}
        actions={
          <>
            <CancelRunButton run={run} />
            <Button asChild>
              <Link to={`/jobs/${run.jobId}`}>{t('detail.viewJob')}</Link>
            </Button>
          </>
        }
      />
      {stale && (
        <p role="status" className="mb-2 text-xs text-warning">
          {t('common:states.stale')}
        </p>
      )}
      <RunErrorBanner run={run} />
      <RunLifecycle run={run} />
      <RunFacts run={run} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('detail.tabs.label')}>
          <TabsTrigger value="operations">
            {t('detail.tabs.operations')}
          </TabsTrigger>
          <TabsTrigger
            value="issues"
            count={run.issueCount}
            warn={run.issueCount > 0}
          >
            {t('detail.tabs.issues')}
          </TabsTrigger>
          <TabsTrigger value="targets" count={run.targets.length}>
            {t('detail.tabs.targets')}
          </TabsTrigger>
          <TabsTrigger value="stats">{t('detail.tabs.stats')}</TabsTrigger>
          <TabsTrigger value="snapshot">
            {t('detail.tabs.snapshot')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="operations">
          <RunOperationsTab run={run} />
        </TabsContent>
        <TabsContent value="issues">
          <RunIssuesTab run={run} />
        </TabsContent>
        <TabsContent value="targets">
          <p className="sr-only">
            {t('detail.targets.title', { count: run.targets.length })}
          </p>
          <RunTargets targets={run.targets} />
        </TabsContent>
        <TabsContent value="stats">
          <RunStatsTab run={run} />
        </TabsContent>
        <TabsContent value="snapshot">
          <RunConfigTab run={run} />
        </TabsContent>
      </Tabs>
      <OperationSheet />
    </section>
  );
}

/** 首次加载时的运行详情：返回链接、生命周期节点名与标签页照常显示，其余按真实布局占位。
 * @returns 详情页骨架。
 * @throws 不适用。
 */
function RunDetailSkeleton() {
  const { t } = useTranslation(['runs', 'common']);
  const [tab, setTab] = useTabParam('tab', TABS, 'operations');
  return (
    <section>
      <SkeletonRegion label={t('detail.loading')}>
        <PageHeader
          back={{ to: '/runs', label: t('common:nav.runs') }}
          title={<TitleSkeleton />}
          badges={<Skeleton className="h-5 w-16" />}
          description={<LineSkeleton className="w-80" />}
          actions={<ButtonSkeleton className="w-24" />}
        />
        <RunLifecycleSkeleton />
        {/* 正式运行与试运行的计数项不同，标签也用占位。 */}
        <FactStrip
          facts={skeletonFacts(
            Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="my-0.5 h-3 w-14" />
            )),
          )}
        />
      </SkeletonRegion>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('detail.tabs.label')}>
          {TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`detail.tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="operations">
          <RunOperationsSkeleton />
        </TabsContent>
        <TabsContent value="issues">
          <RunIssuesSkeleton />
        </TabsContent>
        {(['targets', 'stats', 'snapshot'] as const).map((value) => (
          <TabsContent key={value} value={value}>
            <LoadingState rows={4} />
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

/** 渲染运行详情页面；进行中自动刷新（由 useRun 负责）。
 * @returns 运行详情页面。
 * @throws 不适用；请求错误在页面内显示。
 */
export function RunDetailPage() {
  const { t } = useTranslation(['runs', 'common']);
  const { id = '' } = useParams();
  const run = useRun(id);
  const data = run.data;
  useDocumentTitle(
    data ? (snapshotJobName(data) ?? t('detail.title')) : t('detail.title'),
    t('common:nav.runs'),
  );

  if (!data)
    return run.isError ? (
      <section>
        <PageHeader
          title={t('detail.title')}
          back={{ to: '/runs', label: t('common:nav.runs') }}
        />
        <ErrorState error={run.error} onRetry={() => void run.refetch()} />
      </section>
    ) : (
      <RunDetailSkeleton />
    );

  return <RunDetailView key={data.id} run={data} stale={run.isRefetchError} />;
}
