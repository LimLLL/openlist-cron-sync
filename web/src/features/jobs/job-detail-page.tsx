// 任务详情：编辑式页头与顶栏操作，路径图作为视觉焦点，其后是定时、目标、过滤、高级设置、最近运行与时间线分节。
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { ArrowLeft, Archive, Pencil, Play, Power, PowerOff } from 'lucide-react';
import { useArchiveJob, useJob, useToggleJob } from './job-queries';
import { PageHeader } from '../../components/page-header';
import { Magnetic } from '../../components/motion/magnetic';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '../../components/states';
import { JobTriggerDialog } from './job-trigger-dialog';
import { JobRoute } from './job-route';
import {
  AdvancedSection,
  FiltersSection,
  ScheduleSection,
  TargetsSection,
  TimelineSection,
} from './job-detail-sections';
import { RecentRunsSection } from './job-recent-runs';
import { ScheduleBadge } from './job-ui';
import type { JobView } from './job-contract';

/** 渲染详情页顶栏操作：编辑、归档、定时开关与立即运行。
 * @param props job 任务及各操作回调。
 * @returns 操作按钮组。
 * @throws 不适用。
 */
function JobActions({
  job,
  toggling,
  onToggle,
  onArchive,
  onRun,
}: {
  job: JobView;
  toggling: boolean;
  onToggle: () => void;
  onArchive: () => void;
  onRun: () => void;
}) {
  const { t } = useTranslation(['jobs', 'common']);
  const archived = !!job.archivedAt;
  return (
    <>
      <Button asChild variant="ghost" size="sm">
        <Link to={`/jobs/${job.id}/edit`}>
          <Pencil size={14} aria-hidden="true" />
          {t('common:actions.edit')}
        </Link>
      </Button>
      {!archived && (
        <Button variant="danger" size="sm" onClick={onArchive}>
          <Archive size={14} aria-hidden="true" />
          {t('detail.archiveAction')}
        </Button>
      )}
      <Button variant="secondary" size="sm" onClick={onToggle} disabled={toggling || archived}>
        {job.enabled ? <PowerOff size={14} aria-hidden="true" /> : <Power size={14} aria-hidden="true" />}
        {job.enabled ? t('detail.disable') : t('detail.enable')}
      </Button>
      <Magnetic>
        <Button size="sm" onClick={onRun} disabled={archived}>
          <Play size={14} aria-hidden="true" />
          {t('detail.run')}
        </Button>
      </Magnetic>
    </>
  );
}

/** 渲染任务详情页面。
 * @returns 详情页。
 * @throws 不适用。
 */
export function JobDetailPage() {
  const { t } = useTranslation(['jobs', 'common']);
  const { id } = useParams<{ id: string }>();
  const job = useJob(id!);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const navigate = useNavigate();
  const toggle = useToggleJob(id!);
  const archive = useArchiveJob(id!);

  if (job.isPending) return <LoadingState label={t('detail.loading')} rows={6} />;
  if (job.isError)
    return (
      <ErrorState
        error={job.error}
        onRetry={() => {
          void job.refetch();
        }}
      />
    );
  const data = job.data;

  return (
    <section>
      <PageHeader
        index="03"
        kicker={t('detail.kicker')}
        title={data.name}
        meta={
          <Link to="/jobs" className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">
            <ArrowLeft size={12} aria-hidden="true" />
            {t('detail.allJobs')}
          </Link>
        }
        description={
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <ScheduleBadge job={data} />
              <Badge plain variant="info">
                {t(`createMode.${data.createMode}`)}
              </Badge>
            </div>
            <p>{t('detail.summary', { path: data.source.path, count: data.targets.length })}</p>
          </div>
        }
        actions={
          <JobActions
            job={data}
            toggling={toggle.isPending}
            onToggle={() => toggle.mutate(!data.enabled)}
            onArchive={() => setArchiveOpen(true)}
            onRun={() => setTriggerOpen(true)}
          />
        }
      />

      {toggle.isError && (
        <div className="mb-6">
          <ErrorState error={toggle.error} />
        </div>
      )}

      <JobRoute job={data} />

      <div className="mt-14">
        <ScheduleSection job={data} index="01" />
        <TargetsSection job={data} index="02" />
        <FiltersSection job={data} index="03" />
        <AdvancedSection job={data} index="04" />
        <RecentRunsSection jobId={data.id} index="05" />
        <TimelineSection job={data} index="06" />
      </div>

      {triggerOpen && (
        <JobTriggerDialog
          jobId={data.id}
          jobName={data.name}
          open={triggerOpen}
          onOpenChange={setTriggerOpen}
        />
      )}
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t('detail.archiveTitle')}
        description={
          <Trans
            t={t}
            i18nKey="detail.archiveDescription"
            values={{ name: data.name }}
            components={{ strong: <strong className="text-foreground" /> }}
          />
        }
        confirmLabel={t('common:actions.archive')}
        pending={archive.isPending}
        error={archive.error}
        onConfirm={() => {
          archive.mutate(undefined, {
            onSuccess: () => {
              setArchiveOpen(false);
              void navigate('/jobs');
            },
          });
        }}
      />
    </section>
  );
}
