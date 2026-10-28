// 运行列表：按任务、状态与正式/试运行筛选（全部写进 URL），紧凑表格展示状态、耗时与结果摘要；列表自行按活动状态轮询。
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader, useDocumentTitle } from '../../components/page';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/states';
import { RunStatusBadge } from '../../components/status';
import { RelativeTime, ShortId } from '../../components/text';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { NativeSelect } from '../../components/ui/input';
import { Pagination } from '../../components/ui/pagination';
import { Segmented } from '../../components/ui/segmented';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/table';
import {
  useClearFilters,
  useFilterParam,
  usePageParams,
} from '../../lib/hooks';
import { useJobCatalog } from '../jobs/job-queries';
import { RUN_STATUSES } from './run-contract';
import { useRuns } from './run-queries';
import { RunDuration, RunResultSummary } from './run-cells';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 只保留后端接受的筛选值；URL 中的非法值按“全部”处理而不是触发 400。
 * @param jobId URL 中的任务 ID。
 * @param status URL 中的状态。
 * @param dryRun URL 中的类型。
 * @returns 合法筛选值。
 * @throws 不适用。
 */
function validFilters(
  jobId: string | undefined,
  status: string | undefined,
  dryRun: string | undefined,
) {
  return {
    jobId: jobId && UUID.test(jobId) ? jobId : undefined,
    status:
      status === 'active' ||
      RUN_STATUSES.some((candidate) => candidate === status)
        ? status
        : undefined,
    dryRun: dryRun === 'true' || dryRun === 'false' ? dryRun : undefined,
  };
}

/** 渲染运行列表页面。
 * @returns 带筛选与分页的运行表格。
 * @throws 不适用；请求错误在页面内显示。
 */
export function RunsPage() {
  const { t } = useTranslation(['runs', 'common']);
  useDocumentTitle(t('common:nav.runs'));
  const { page, pageSize, setPage } = usePageParams();
  const [rawJobId, setJobId] = useFilterParam('jobId');
  const [rawStatus, setStatus] = useFilterParam('status');
  const [rawDryRun, setDryRun] = useFilterParam('dryRun');
  const clearFilters = useClearFilters(['jobId', 'status', 'dryRun']);
  const { jobId, status, dryRun } = validFilters(
    rawJobId,
    rawStatus,
    rawDryRun,
  );
  const runs = useRuns({ page, pageSize, jobId, status, dryRun });
  const jobs = useJobCatalog({ includeArchived: true });
  const filtered = Boolean(jobId || status || dryRun);
  const data = runs.data;

  // 任务下拉框按名称排序；当前筛选的任务不在目录里时仍保留一个选项，避免选中值消失。
  const jobOptions = useMemo(() => {
    const options = (jobs.data ?? [])
      .map((job) => ({
        id: job.id,
        label: job.archivedAt
          ? t('list.archivedJob', { name: job.name })
          : job.name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (jobId && !options.some((option) => option.id === jobId))
      options.unshift({
        id: jobId,
        label: runs.data?.items[0]?.jobName ?? jobId.slice(0, 8),
      });
    return options;
  }, [jobs.data, jobId, runs.data, t]);

  return (
    <section>
      <PageHeader
        title={t('common:nav.runs')}
        description={data ? t('list.total', { count: data.total }) : undefined}
      />

      <div
        role="group"
        aria-label={t('list.filters')}
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        <NativeSelect
          aria-label={t('list.jobFilter')}
          value={jobId ?? ''}
          onChange={(event) => setJobId(event.target.value || undefined)}
          className="w-56"
        >
          <option value="">{t('list.allJobs')}</option>
          {jobOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('list.statusFilter')}
          value={status ?? ''}
          onChange={(event) => setStatus(event.target.value || undefined)}
          className="w-40"
        >
          <option value="">{t('list.allStatuses')}</option>
          <option value="active">{t('list.activeStatuses')}</option>
          {RUN_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`common:runStatus.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <Segmented
          label={t('list.typeFilter')}
          value={dryRun ?? ''}
          onChange={(value) => setDryRun(value || undefined)}
          options={[
            { value: '', label: t('list.allTypes') },
            { value: 'false', label: t('list.realOnly') },
            { value: 'true', label: t('list.dryOnly') },
          ]}
        />
        {filtered && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {t('common:actions.clearFilters')}
          </Button>
        )}
      </div>

      {runs.isRefetchError && (
        <p role="status" className="mb-2 text-xs text-warning">
          {t('common:states.stale')}
        </p>
      )}

      {!data ? (
        runs.isError ? (
          <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
        ) : (
          <TableSkeleton columns={8} label={t('list.loading')} />
        )
      ) : data.items.length === 0 ? (
        <>
          {filtered ? (
            <EmptyState
              title={t('common:states.noMatches')}
              action={
                <Button onClick={clearFilters}>
                  {t('common:actions.clearFilters')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={t('list.emptyTitle')}
              description={t('list.emptyDescription')}
            />
          )}
          {/* 越界页码下列表为空，仍提供翻页回到有效页。 */}
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPageChange={(next) => setPage({ page: next })}
            className="mt-3"
          />
        </>
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH className="w-28">{t('list.columns.status')}</TH>
                <TH>{t('list.columns.job')}</TH>
                <TH className="w-20">{t('list.columns.type')}</TH>
                <TH className="w-20">{t('list.columns.trigger')}</TH>
                <TH className="w-28">{t('list.columns.started')}</TH>
                <TH className="w-24">{t('list.columns.duration')}</TH>
                <TH>{t('list.columns.result')}</TH>
                <TH className="w-24">{t('list.columns.id')}</TH>
              </tr>
            </THead>
            <TBody>
              {data.items.map((run) => (
                <TR key={run.id}>
                  <TD>
                    <RunStatusBadge
                      status={run.status}
                      stopReason={run.stopReason}
                    />
                  </TD>
                  <TD className="max-w-72">
                    <Link
                      to={`/runs/${run.id}`}
                      className="block truncate font-medium hover:underline"
                      title={run.jobName}
                    >
                      {run.jobName}
                    </Link>
                  </TD>
                  <TD>
                    {run.dryRun ? (
                      <Badge>{t('common:dryRun')}</Badge>
                    ) : (
                      <span className="text-muted-foreground">
                        {t('list.real')}
                      </span>
                    )}
                  </TD>
                  <TD className="text-muted-foreground">
                    {t(`common:trigger.${run.trigger}`)}
                  </TD>
                  <TD>
                    {run.startedAt ? (
                      <RelativeTime iso={run.startedAt} />
                    ) : (
                      <span className="text-muted-foreground">
                        {t('list.notStarted')}
                      </span>
                    )}
                  </TD>
                  <TD>
                    <RunDuration run={run} />
                  </TD>
                  <TD className="text-[13px]">
                    <RunResultSummary run={run} />
                  </TD>
                  <TD>
                    <ShortId id={run.id} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPageChange={(next) => setPage({ page: next })}
            className="mt-3"
          />
        </>
      )}
    </section>
  );
}
