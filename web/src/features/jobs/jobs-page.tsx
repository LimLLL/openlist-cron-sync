// 任务列表：完整目录在前端搜索、筛选、排序与分页（状态都在 URL），每行显示路径、定时、上次正式运行与行内操作。
import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Play, Plus, Search } from 'lucide-react';
import { PageHeader, useDocumentTitle } from '../../components/page';
import {
  EmptyState,
  ErrorState,
  StaleNotice,
  TableSkeleton,
} from '../../components/states';
import { Endpoint, RelativeTime } from '../../components/text';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Pagination } from '../../components/ui/pagination';
import { Segmented } from '../../components/ui/segmented';
import {
  SortHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../../components/ui/table';
import { Tip } from '../../components/ui/tooltip';
import {
  useClearFilters,
  useFilterParam,
  usePageParams,
} from '../../lib/hooks';
import { activeRunsByJob, useActiveRuns } from '../runs/run-queries';
import type { RunListItem } from '../runs/run-contract';
import { JobActionsMenu } from './job-actions';
import {
  ActiveRunLink,
  LastRealRun,
  ScheduleText,
  TargetsSummary,
  useInstanceName,
} from './job-display';
import { jobAttention } from './job-health';
import { useJobCatalog } from './job-queries';
import { JobTriggerDialog } from './job-trigger-dialog';
import type { JobListItem } from './job-contract';

const FILTERS = [
  'all',
  'attention',
  'running',
  'disabled',
  'archived',
] as const;
/** 列表筛选。 */
type Filter = (typeof FILTERS)[number];

const SORTS = ['name', 'lastRun', 'nextFire'] as const;
/** 可排序列。 */
type SortKey = (typeof SORTS)[number];

const PAGE_DEFAULTS = { page: 1, pageSize: 50 };

/** 读取并更新 URL 中的排序列与方向；变更排序时回到第一页。
 * @returns 当前排序与切换函数。
 * @throws 不适用。
 */
function useSortParams(): {
  sort: SortKey;
  dir: 'asc' | 'desc';
  toggle: (key: SortKey) => void;
} {
  const [params, setParams] = useSearchParams();
  const raw = params.get('sort');
  const sort = SORTS.find((key) => key === raw) ?? 'name';
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc';
  const toggle = useCallback(
    (key: SortKey) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          const nextDir = key === sort && dir === 'asc' ? 'desc' : 'asc';
          if (key === 'name') next.delete('sort');
          else next.set('sort', key);
          if (nextDir === 'asc') next.delete('dir');
          else next.set('dir', nextDir);
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [dir, setParams, sort],
  );
  return { sort, dir, toggle };
}

/** 比较两个可空 ISO 时间；空值总排在最后。
 * @param a 时间 A。
 * @param b 时间 B。
 * @param dir 排序方向。
 * @returns 比较结果。
 * @throws 不适用。
 */
function compareTime(
  a: string | null | undefined,
  b: string | null | undefined,
  dir: 'asc' | 'desc',
): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const diff = Date.parse(a) - Date.parse(b);
  return dir === 'asc' ? diff : -diff;
}

/** 判断任务是否符合筛选。
 * @param job 任务。
 * @param filter 筛选。
 * @param active 任务 ID 到活动运行的映射。
 * @returns 是否保留。
 * @throws 不适用。
 */
function matchesFilter(
  job: JobListItem,
  filter: Filter,
  active: Map<string, RunListItem>,
): boolean {
  if (filter === 'archived') return job.archivedAt !== null;
  if (job.archivedAt !== null) return false;
  if (filter === 'attention') return jobAttention(job).length > 0;
  if (filter === 'running') return active.has(job.id);
  if (filter === 'disabled') return Boolean(job.cron) && !job.enabled;
  return true;
}

/** 渲染“新建任务”入口。
 * @returns 主操作按钮。
 * @throws 不适用。
 */
function CreateButton() {
  const { t } = useTranslation('jobs');
  return (
    <Button asChild variant="primary">
      <Link to="/jobs/new">
        <Plus size={14} aria-hidden="true" />
        {t('list.create')}
      </Link>
    </Button>
  );
}

/** 渲染任务列表页。
 * @returns 任务列表。
 * @throws 不适用；请求错误在页面内显示。
 */
export function JobsPage() {
  const { t } = useTranslation(['jobs', 'common']);
  useDocumentTitle(t('list.title'));
  const [rawFilter, setFilter] = useFilterParam('filter');
  const filter: Filter = FILTERS.find((item) => item === rawFilter) ?? 'all';
  const [query = '', setQuery] = useFilterParam('q');
  const clearFilters = useClearFilters(['q', 'filter']);
  const { sort, dir, toggle } = useSortParams();
  const { page, pageSize, setPage } = usePageParams(PAGE_DEFAULTS);
  const catalog = useJobCatalog({
    includeArchived: filter === 'archived',
    poll: true,
  });
  const activeRuns = useActiveRuns();
  const instanceName = useInstanceName();
  const [trigger, setTrigger] = useState<{
    job: JobListItem;
    dryRun: boolean;
  } | null>(null);

  const active = useMemo(
    () => activeRunsByJob(activeRuns.data),
    [activeRuns.data],
  );
  const jobs = useMemo(() => catalog.data ?? [], [catalog.data]);

  // 计数只统计未归档任务；归档数量仅在加载了归档目录时可知。
  const counts = useMemo(() => {
    const current = jobs.filter((job) => job.archivedAt === null);
    return {
      all: current.length,
      attention: current.filter((job) => jobAttention(job).length > 0).length,
      running: current.filter((job) => active.has(job.id)).length,
      disabled: current.filter((job) => job.cron && !job.enabled).length,
      archived:
        filter === 'archived' ? jobs.length - current.length : undefined,
    };
  }, [active, filter, jobs]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matched = jobs.filter((job) => {
      if (!matchesFilter(job, filter, active)) return false;
      if (!needle) return true;
      const haystack = [
        job.name,
        job.source.path,
        instanceName(job.source.instanceId),
        ...job.targets.flatMap((target) => [
          target.path,
          instanceName(target.instanceId),
        ]),
      ];
      return haystack.some((value) =>
        value.toLocaleLowerCase().includes(needle),
      );
    });
    return matched.sort((a, b) => {
      if (sort === 'lastRun')
        return compareTime(
          a.latestTerminalRealRun?.endedAt,
          b.latestTerminalRealRun?.endedAt,
          dir,
        );
      if (sort === 'nextFire')
        return compareTime(a.nextFireAt, b.nextFireAt, dir);
      const order = a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      return dir === 'asc' ? order : -order;
    });
    // instanceName 随实例目录变化，目录更新后重新筛选。
  }, [active, dir, filter, instanceName, jobs, query, sort]);

  const pageItems = visible.slice((page - 1) * pageSize, page * pageSize);
  const filtered = filter !== 'all' || query.trim() !== '';
  const direction = (key: SortKey) => (sort === key ? dir : null);

  return (
    <section>
      <PageHeader
        title={t('list.title')}
        description={
          catalog.data
            ? t('list.count', { count: counts.all })
            : t('list.loading')
        }
        actions={<CreateButton />}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value || undefined)}
            placeholder={t('list.search')}
            aria-label={t('list.search')}
            className="pl-8"
          />
        </div>
        <Segmented
          label={t('list.filterLabel')}
          value={filter}
          onChange={(value) => setFilter(value === 'all' ? undefined : value)}
          options={FILTERS.map((value) => ({
            value,
            label: t(`list.filter.${value}`),
            count: catalog.data ? counts[value] : undefined,
          }))}
        />
      </div>

      <StaleNotice show={catalog.isRefetchError} />
      {activeRuns.error && (
        <ErrorState
          error={activeRuns.error}
          onRetry={() => void activeRuns.refetch()}
          compact
        />
      )}
      {catalog.isPending ||
      (filter === 'running' && !activeRuns.data && !activeRuns.error) ? (
        <TableSkeleton columns={7} label={t('list.loading')} />
      ) : catalog.isError && !catalog.data ? (
        <ErrorState
          error={catalog.error}
          onRetry={() => {
            void catalog.refetch();
          }}
        />
      ) : filter === 'running' && !activeRuns.data ? null : visible.length ===
        0 ? (
        filtered ? (
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
            action={<CreateButton />}
          />
        )
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <SortHeader
                  direction={direction('name')}
                  onSort={() => toggle('name')}
                >
                  {t('list.col.name')}
                </SortHeader>
                <TH>{t('list.col.source')}</TH>
                <TH>{t('list.col.target')}</TH>
                <TH>{t('list.col.schedule')}</TH>
                <SortHeader
                  direction={direction('lastRun')}
                  onSort={() => toggle('lastRun')}
                >
                  {t('list.col.lastRun')}
                </SortHeader>
                <SortHeader
                  direction={direction('nextFire')}
                  onSort={() => toggle('nextFire')}
                >
                  {t('list.col.nextRun')}
                </SortHeader>
                <TH className="text-right">
                  <span className="sr-only">{t('list.col.actions')}</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {pageItems.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  active={active.get(job.id)}
                  activityKnown={activeRuns.data !== undefined}
                  instanceName={instanceName}
                  onRun={(dryRun) => setTrigger({ job, dryRun })}
                />
              ))}
            </TBody>
          </Table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={visible.length}
            onPageChange={(next) => setPage({ page: next })}
            className="mt-3"
          />
        </>
      )}

      <JobTriggerDialog
        job={trigger?.job ?? null}
        initialDryRun={trigger?.dryRun ?? false}
        onClose={() => setTrigger(null)}
      />
    </section>
  );
}

/** 渲染一行任务。
 * @param props job 任务；active 进行中的运行；instanceName 实例名查找；onRun 打开运行对话框。
 * @returns 表格行。
 * @throws 不适用。
 */
function JobRow({
  job,
  active,
  activityKnown,
  instanceName,
  onRun,
}: {
  job: JobListItem;
  active: RunListItem | undefined;
  activityKnown: boolean;
  instanceName: (id: string) => string;
  onRun: (dryRun: boolean) => void;
}) {
  const { t } = useTranslation(['jobs', 'common']);
  const archived = job.archivedAt !== null;
  const runBlocked = archived
    ? t('list.runArchived')
    : active
      ? t('list.runBusy')
      : !activityKnown
        ? t('common:states.activityUnknown')
        : null;
  return (
    <TR>
      <TD className="max-w-64">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={archived ? `/runs?jobId=${job.id}` : `/jobs/${job.id}`}
            className="truncate font-medium hover:underline"
          >
            {job.name}
          </Link>
          {archived && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {t('list.archived')}
            </span>
          )}
        </div>
      </TD>
      <TD className="max-w-56">
        <Endpoint
          instance={instanceName(job.source.instanceId)}
          path={job.source.path}
        />
      </TD>
      <TD className="max-w-64">
        <TargetsSummary job={job} instanceName={instanceName} />
      </TD>
      <TD className="max-w-48">
        <ScheduleText job={job} />
      </TD>
      <TD>
        <div className="flex flex-col gap-1">
          {active && <ActiveRunLink run={active} />}
          <LastRealRun run={job.latestTerminalRealRun} />
        </div>
      </TD>
      <TD className="whitespace-nowrap text-[13px]">
        <RelativeTime iso={job.nextFireAt} />
      </TD>
      <TD className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Tip content={runBlocked}>
            {/* 禁用按钮不触发悬停事件，外包一层承载提示。 */}
            <span tabIndex={runBlocked ? 0 : undefined}>
              <Button
                size="sm"
                disabled={runBlocked !== null}
                onClick={() => onRun(false)}
              >
                <Play size={13} aria-hidden="true" />
                {t('actions.run')}
              </Button>
            </span>
          </Tip>
          <JobActionsMenu
            job={job}
            busy={active !== undefined || !activityKnown}
            onDryRun={() => onRun(true)}
          />
        </div>
      </TD>
    </TR>
  );
}
