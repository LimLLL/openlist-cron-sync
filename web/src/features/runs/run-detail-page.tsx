// 运行档案页：编辑式页头（任务名、返回与取消），档案头部大数字，随后是生命周期、目标、操作与问题、计数和快照分节。
import { Link, useParams } from 'react-router';
import { ArrowLeft, ArrowUpRight, Ban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/page-header';
import { Button } from '../../components/ui/button';
import { EditorialSection } from '../../components/ui/editorial-section';
import { ErrorState, LoadingState } from '../../components/states';
import { formatRelative } from '../../lib/format';
import { useRunDetail, useCancelRun } from './run-queries';
import { ACTIVE_RUN_STATUSES } from './run-contract';
import { snapshotJobName } from './run-format';
import { RunDossier } from './run-dossier';
import { RunLifecycle } from './run-lifecycle';
import { RunTargets } from './run-targets';
import { RunSnapshot, RunStatistics } from './run-statistics';
import { DetailTabs } from './run-detail-tabs';

/** 渲染运行档案页。
 * @returns 详情页或加载/错误状态。
 * @throws 不适用。
 */
export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const run = useRunDetail(id!);
  const cancel = useCancelRun();
  const { t } = useTranslation(['runs', 'common']);

  if (run.isPending)
    return <LoadingState rows={6} label={t('detail.loading')} />;
  if (run.isError)
    return <ErrorState error={run.error} onRetry={() => void run.refetch()} />;

  const detail = run.data;
  const shortId = detail.id.slice(0, 8);
  const canCancel =
    ACTIVE_RUN_STATUSES.has(detail.status) && !detail.cancelRequestedAt;
  // 没有计划任何改动却有扫描问题时，问题才是用户要看的内容。
  const plannedWork = [
    'plannedCreates',
    'plannedReplacements',
    'plannedExtraDeletes',
    'plannedDirectoryDeletes',
  ].reduce((total, key) => total + (detail.stats[key] ?? 0), 0);
  // 分节编号按实际出现的分节顺序生成，没有目标时不留空号。
  const sections = [
    {
      key: 'lifecycle',
      title: t('detail.sections.lifecycle'),
      description: t('detail.sections.lifecycleNote'),
      body: <RunLifecycle detail={detail} />,
    },
    ...(detail.targets.length > 0
      ? [
          {
            key: 'targets',
            title: t('detail.targets.title', { count: detail.targets.length }),
            description: t('detail.sections.targetsNote'),
            body: <RunTargets targets={detail.targets} />,
          },
        ]
      : []),
    {
      key: 'activity',
      title: t('detail.sections.activity'),
      description: t('detail.sections.activityNote'),
      body: (
        <DetailTabs
          runId={detail.id}
          issueCount={detail.issueCount}
          status={detail.status}
          preferIssues={detail.issueCount > 0 && plannedWork === 0}
        />
      ),
    },
    {
      key: 'statistics',
      title: t('detail.sections.statistics'),
      description: t('detail.sections.statisticsNote'),
      body: <RunStatistics stats={detail.stats} />,
    },
    {
      key: 'snapshot',
      title: t('detail.sections.snapshot'),
      description: t('detail.sections.snapshotNote'),
      body: <RunSnapshot config={detail.config} />,
    },
  ];

  return (
    <section>
      <PageHeader
        index="04"
        kicker={
          <>
            {t('common:nav.runs')}
            <span className="ml-2 font-mono text-muted-foreground/80 normal-case">
              {shortId}
            </span>
          </>
        }
        title={snapshotJobName(detail) ?? t('detail.untitled', { id: shortId })}
        description={t('detail.description', {
          trigger: t(`detail.trigger.${detail.trigger}`),
          time: formatRelative(detail.createdAt),
        })}
        meta={
          <Link
            to="/runs"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
          >
            <ArrowLeft size={12} aria-hidden="true" />
            {t('detail.back')}
          </Link>
        }
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link to={`/jobs/${detail.jobId}`}>
                {t('detail.viewJob')}
                <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            </Button>
            {canCancel && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => cancel.mutate(detail.id)}
                disabled={cancel.isPending}
              >
                <Ban size={14} aria-hidden="true" />
                {cancel.isPending ? t('detail.cancelling') : t('detail.cancel')}
              </Button>
            )}
          </>
        }
      />
      {cancel.isError && (
        <div className="mb-8">
          <ErrorState error={cancel.error} />
        </div>
      )}
      <RunDossier detail={detail} />
      {sections.map((section, position) => (
        <EditorialSection
          key={section.key}
          index={String(position + 1).padStart(2, '0')}
          title={section.title}
          description={section.description}
        >
          {section.body}
        </EditorialSection>
      ))}
    </section>
  );
}
