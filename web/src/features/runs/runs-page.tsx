// 运行列表：编辑式页头、类型与状态筛选、编号行列表；按任务筛选时显示可清除的任务标签。
import { CalendarClock, Hand, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/page-header';
import { Badge } from '../../components/ui/badge';
import { IndexHead, IndexList, IndexRow } from '../../components/ui/index-list';
import { Pagination } from '../../components/ui/pagination';
import { Segmented } from '../../components/ui/segmented';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { usePageParams, useFilterParam } from '../../lib/hooks';
import { formatDuration, formatTime } from '../../lib/format';
import { useJobNames, useRuns } from './run-queries';
import { RUN_STATUSES } from './run-contract';
import type { RunView } from './run-contract';
import { statusBadgeProps } from './run-status';
import { runDurationSeconds } from './run-format';
import { FilterSelect } from './filter-select';

/** 运行类型筛选值。 */
type RunType = 'all' | 'real' | 'dry';

/** 渲染运行列表页。
 * @returns 运行列表。
 * @throws 不适用。
 */
export function RunsPage() {
  const { t } = useTranslation(['runs', 'common']);
  const { page, pageSize, setPage } = usePageParams();
  const [status, setStatus] = useFilterParam('status');
  const [dryRun, setDryRun] = useFilterParam('dryRun');
  const [jobId, setJobId] = useFilterParam('jobId');
  const runs = useRuns({ page, pageSize, status, dryRun, jobId });
  // 任务名只用于展示；查询失败时行内回退显示任务 ID，不阻塞列表。
  const names = useJobNames().data;
  const filtered = Boolean(status || dryRun || jobId);
  const type: RunType = dryRun === 'true' ? 'dry' : dryRun === 'false' ? 'real' : 'all';

  return (
    <section>
      <PageHeader
        index="04"
        kicker={t('common:nav.runs')}
        title={t('list.title')}
        accent={t('list.accent')}
        description={t('list.description')}
        meta={runs.data ? t('list.total', { count: runs.data.total }) : undefined}
      />

      <div role="group" aria-label={t('list.filters')} className="mb-8 flex flex-wrap items-center gap-3">
        <Segmented<RunType>
          label={t('list.typeFilter')}
          value={type}
          onChange={(next) => setDryRun(next === 'all' ? undefined : next === 'dry' ? 'true' : 'false')}
          options={[
            { value: 'all', label: t('list.allTypes') },
            { value: 'real', label: t('common:realRun') },
            { value: 'dry', label: t('common:dryRun') },
          ]}
        />
        <FilterSelect
          label={t('list.statusFilter')}
          value={status ?? ''}
          onChange={(next) => setStatus(next || undefined)}
        >
          <option value="">{t('list.allStatuses')}</option>
          {RUN_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`common:runStatus.${value}`)}
            </option>
          ))}
        </FilterSelect>
        {jobId && (
          <button
            type="button"
            onClick={() => setJobId(undefined)}
            title={t('list.clearJob')}
            className="inline-flex h-[2.375rem] items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.06] pr-3 pl-4 text-xs font-medium text-accent transition-colors hover:bg-accent/[0.12]"
          >
            {t('list.jobFilter', { name: names?.get(jobId) ?? jobId.slice(0, 8) })}
            <X size={13} aria-hidden="true" />
            <span className="sr-only">{t('list.clearJob')}</span>
          </button>
        )}
      </div>

      {runs.isPending ? (
        <LoadingState rows={6} label={t('list.loading')} />
      ) : runs.isError ? (
        <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
      ) : runs.data.items.length === 0 ? (
        <>
          <EmptyState
            title={filtered ? t('list.emptyFilteredTitle') : t('list.emptyTitle')}
            description={filtered ? t('list.emptyFilteredDescription') : t('list.emptyDescription')}
          />
          {/* 超出范围的页码仍需返回入口。 */}
          <Pagination
            className="mt-6"
            page={page}
            pageSize={pageSize}
            total={runs.data.total}
            onPageChange={(next) => setPage({ page: next })}
          />
        </>
      ) : (
        <>
          <IndexHead
            title={t('list.columns.job')}
            cells={[t('list.columns.trigger'), t('list.columns.started'), t('list.columns.duration')]}
            status={t('list.columns.status')}
          />
          <IndexList>
            {runs.data.items.map((run, position) => (
              <RunRow
                key={run.id}
                run={run}
                index={(runs.data.page - 1) * runs.data.pageSize + position + 1}
                name={names?.get(run.jobId)}
              />
            ))}
          </IndexList>
          <Pagination
            className="mt-8"
            page={runs.data.page}
            pageSize={runs.data.pageSize}
            total={runs.data.total}
            onPageChange={(next) => setPage({ page: next })}
          />
        </>
      )}
    </section>
  );
}

/** 渲染单行运行条目。
 * @param props run 运行；index 全局序号；name 任务名（可能尚未加载）。
 * @returns 编号行。
 * @throws 不适用。
 */
function RunRow({ run, index, name }: { run: RunView; index: number; name?: string }) {
  const { t } = useTranslation(['runs', 'common']);
  const badge = statusBadgeProps(run.status);
  const duration = runDurationSeconds(run);
  const TriggerIcon = run.trigger === 'cron' ? CalendarClock : Hand;
  return (
    <IndexRow
      to={`/runs/${run.id}`}
      index={index}
      title={name ?? t('list.unknownJob', { id: run.jobId.slice(0, 8) })}
      subtitle={
        <>
          {run.id.slice(0, 8)}
          {run.dryRun && <span className="ml-2 text-accent/80">· {t('common:dryRun')}</span>}
        </>
      }
      cells={[
        <span key="trigger" className="inline-flex items-center gap-1.5">
          <TriggerIcon size={12} aria-hidden="true" />
          {t(`common:trigger.${run.trigger}`)}
        </span>,
        run.startedAt ? formatTime(run.startedAt) : t('list.notStarted'),
        duration === null ? '—' : formatDuration(duration),
      ]}
      status={
        <Badge variant={badge.variant} pulse={badge.pulse}>
          {t(`common:runStatus.${run.status}`)}
        </Badge>
      }
    />
  );
}
