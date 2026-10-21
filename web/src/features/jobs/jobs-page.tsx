// 任务列表：编辑式页头加编号行，每行展示名称、源到目标的路径、定时与状态。
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Plus } from 'lucide-react';
import { useJobs } from './job-queries';
import { usePageParams } from '../../lib/hooks';
import { PageHeader } from '../../components/page-header';
import { Magnetic } from '../../components/motion/magnetic';
import { Button } from '../../components/ui/button';
import { IndexHead, IndexList, IndexRow } from '../../components/ui/index-list';
import { Pagination } from '../../components/ui/pagination';
import { ErrorState, LoadingState, EmptyState } from '../../components/states';
import { ScheduleBadge } from './job-ui';
import type { JobView } from './job-contract';

/** 渲染“新建任务”入口。
 * @returns 主操作按钮。
 * @throws 不适用。
 */
function CreateButton() {
  const { t } = useTranslation('jobs');
  return (
    <Magnetic>
      <Button asChild size="sm">
        <Link to="/jobs/new">
          <Plus size={15} aria-hidden="true" />
          {t('list.create')}
        </Link>
      </Button>
    </Magnetic>
  );
}

/** 渲染路径列：单目标显示目标路径，多目标显示数量。
 * @param props job 任务。
 * @returns 路径摘要。
 * @throws 不适用。
 */
function RouteCell({ job }: { job: JobView }) {
  const { t } = useTranslation('jobs');
  const [first] = job.targets;
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <ArrowRight size={12} className="shrink-0 text-accent" aria-hidden="true" />
      <span className="truncate">
        {job.targets.length === 1 && first
          ? first.path
          : t('list.targets', { count: job.targets.length })}
      </span>
    </span>
  );
}

/** 渲染定时列：Cron 与时区，或“仅手动”。
 * @param props job 任务。
 * @returns 定时摘要。
 * @throws 不适用。
 */
function ScheduleCell({ job }: { job: JobView }) {
  const { t } = useTranslation('jobs');
  if (!job.cron) return <span>{t('list.manualOnly')}</span>;
  return (
    <span>
      <span className="text-foreground">{job.cron}</span>
      <span className="ml-2 opacity-60">{job.timezone}</span>
    </span>
  );
}

/** 渲染任务列表页面。
 * @returns 分页任务列表。
 * @throws 不适用。
 */
export function JobsPage() {
  const { t } = useTranslation(['jobs', 'common']);
  const { page, pageSize, setPage } = usePageParams();
  const jobs = useJobs(page, pageSize);

  return (
    <section>
      <PageHeader
        index="03"
        kicker={t('common:nav.jobs')}
        title={t('list.title')}
        accent={t('list.accent')}
        description={t('list.description')}
        meta={jobs.data ? t('list.count', { count: jobs.data.total }) : undefined}
        actions={<CreateButton />}
      />

      {jobs.isPending ? (
        <LoadingState label={t('list.loading')} rows={6} />
      ) : jobs.isError ? (
        <ErrorState
          error={jobs.error}
          onRetry={() => {
            void jobs.refetch();
          }}
        />
      ) : jobs.data.items.length === 0 ? (
        <>
          <EmptyState
            title={t('list.emptyTitle')}
            description={t('list.emptyDescription')}
            action={<CreateButton />}
          />
          {/* 越界页码下列表为空，仍提供翻页回到有效页。 */}
          <Pagination
            page={page}
            pageSize={pageSize}
            total={jobs.data.total}
            onPageChange={(next) => setPage({ page: next })}
            className="mt-6"
          />
        </>
      ) : (
        <>
          <IndexHead
            title={t('list.colName')}
            cells={[t('list.colRoute'), t('list.colSchedule')]}
            status={t('list.colState')}
          />
          <IndexList>
            {jobs.data.items.map((job, position) => (
              <IndexRow
                key={job.id}
                to={`/jobs/${job.id}`}
                index={(jobs.data.page - 1) * jobs.data.pageSize + position + 1}
                title={job.name}
                subtitle={
                  <>
                    {job.source.path}
                    <span className="mx-2 opacity-40">·</span>
                    {t(`createMode.${job.createMode}`)}
                  </>
                }
                cells={[<RouteCell key="route" job={job} />, <ScheduleCell key="schedule" job={job} />]}
                status={<ScheduleBadge job={job} />}
              />
            ))}
          </IndexList>
          <Pagination
            page={jobs.data.page}
            pageSize={jobs.data.pageSize}
            total={jobs.data.total}
            onPageChange={(next) => setPage({ page: next })}
            className="mt-8"
          />
        </>
      )}
    </section>
  );
}
