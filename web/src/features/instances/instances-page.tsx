// 实例列表：搜索与状态筛选（URL 保存）、紧凑表格、行内测试连接与更多操作（编辑/浏览/查看操作/归档）。
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import { PageHeader, useDocumentTitle } from '../../components/page';
import { TableSkeleton } from '../../components/skeleton';
import { EmptyState, ErrorState, StaleNotice } from '../../components/states';
import { PathText, RelativeTime } from '../../components/text';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '../../components/ui/menu';
import { Pagination } from '../../components/ui/pagination';
import { Segmented } from '../../components/ui/segmented';
import { TBody, TD, TH, THead, TR, Table } from '../../components/ui/table';
import { Tip } from '../../components/ui/tooltip';
import { useErrorText } from '../../i18n/error-text';
import {
  useClearFilters,
  useFilterParam,
  usePageParams,
} from '../../lib/hooks';
import { useJobCatalog } from '../jobs/job-queries';
import { InstanceBrowseDialog } from './instance-browse-dialog';
import {
  ArchiveInstanceDialog,
  useAuthLabel,
  useConnectionTest,
  usageCounts,
} from './instance-actions';
import {
  InstanceHealthBadge,
  instanceHealth,
  instanceNeedsAttention,
  shortVersion,
} from './instance-health';
import { useInstanceCatalog } from './instance-queries';
import type { Instance } from './instance-contract';

const FILTERS = ['all', 'attention', 'untested'] as const;
/** 状态筛选值。 */
type Filter = (typeof FILTERS)[number];

/** 判断实例是否符合筛选与搜索词。
 * @param instance 实例。
 * @param filter 状态筛选。
 * @param query 已转小写的搜索词。
 * @returns 是否保留。
 * @throws 不适用。
 */
function matches(instance: Instance, filter: Filter, query: string): boolean {
  if (filter === 'attention' && !instanceNeedsAttention(instance)) return false;
  if (filter === 'untested' && instanceHealth(instance) !== 'untested')
    return false;
  if (!query) return true;
  return (
    instance.name.toLowerCase().includes(query) ||
    instance.baseUrl.toLowerCase().includes(query)
  );
}

/** 渲染实例列表页。
 * @returns 实例列表。
 * @throws 不适用；请求错误就地显示并可重试。
 */
export function InstancesPage() {
  const { t } = useTranslation(['instances', 'common']);
  useDocumentTitle(t('list.title'));
  // 本页持有实例目录的轮询；任务目录只读，用于统计引用数。
  const catalog = useInstanceCatalog({ poll: true });
  const jobs = useJobCatalog();
  const [rawQuery, setQuery] = useFilterParam('q');
  const [rawFilter, setFilter] = useFilterParam('filter');
  const clearFilters = useClearFilters(['q', 'filter']);
  const filter: Filter = FILTERS.find((value) => value === rawFilter) ?? 'all';
  const query = rawQuery ?? '';
  const { page, pageSize, setPage } = usePageParams({ page: 1, pageSize: 50 });
  const { test, run } = useConnectionTest();
  const [browsing, setBrowsing] = useState<Instance | null>(null);
  const [archiving, setArchiving] = useState<Instance | null>(null);

  const items = useMemo(() => catalog.data ?? [], [catalog.data]);
  const counts = useMemo(
    () => (jobs.data ? usageCounts(jobs.data) : null),
    [jobs.data],
  );
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () => items.filter((instance) => matches(instance, filter, needle)),
    [items, filter, needle],
  );
  const filterCounts = useMemo(
    () => ({
      all: items.length,
      attention: items.filter(instanceNeedsAttention).length,
      untested: items.filter(
        (instance) => instanceHealth(instance) === 'untested',
      ).length,
    }),
    [items],
  );
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  // 搜索与筛选是静态控件，首次加载时就显示；计数要等目录加载完成。
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-72">
        <Search
          size={14}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label={t('list.search')}
          placeholder={t('list.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value || undefined)}
          className="pl-8"
        />
      </div>
      <Segmented
        label={t('list.filterLabel')}
        value={filter}
        onChange={(value) => setFilter(value === 'all' ? undefined : value)}
        options={FILTERS.map((value) => ({
          value,
          label: t(`list.filters.${value}`),
          count: catalog.data ? filterCounts[value] : undefined,
        }))}
      />
    </div>
  );
  const create = (
    <Button asChild variant="primary">
      <Link to="/instances/new">
        <Plus size={14} aria-hidden="true" />
        {t('list.create')}
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('list.title')}
        description={
          catalog.data ? t('list.count', { count: items.length }) : undefined
        }
        actions={create}
      />

      <StaleNotice show={catalog.isRefetchError} />
      {catalog.isPending ? (
        <div className="space-y-3">
          {toolbar}
          <TableSkeleton
            rows={5}
            head={<InstancesTableHead />}
            columns={[
              'badge',
              'title',
              'path',
              { kind: 'text', className: 'hidden lg:table-cell' },
              { kind: 'text', className: 'hidden xl:table-cell' },
              'text',
              { kind: 'number', className: 'text-right' },
              'time',
              { kind: 'actions', className: 'text-right' },
            ]}
            label={t('list.loading')}
          />
        </div>
      ) : catalog.isError && !catalog.data ? (
        <ErrorState
          error={catalog.error}
          onRetry={() => void catalog.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('list.emptyTitle')}
          description={t('list.emptyDescription')}
          action={create}
        />
      ) : (
        <div className="space-y-3">
          {toolbar}
          {filtered.length === 0 ? (
            <EmptyState
              title={t('common:states.noMatches')}
              action={
                <Button onClick={clearFilters}>
                  {t('common:actions.clearFilters')}
                </Button>
              }
            />
          ) : (
            <>
              <Table>
                <InstancesTableHead />
                <TBody>
                  {visible.map((instance) => (
                    <InstanceRow
                      key={instance.id}
                      instance={instance}
                      jobs={counts?.get(instance.id) ?? (counts ? 0 : null)}
                      testing={
                        test.isPending && test.variables?.id === instance.id
                      }
                      // 同一时刻只测试一个实例：mutate 的回调只对最后一次调用生效，并行点击会丢失前一个结果提示。
                      testBusy={test.isPending}
                      onTest={() => run(instance)}
                      onBrowse={() => setBrowsing(instance)}
                      onArchive={() => setArchiving(instance)}
                    />
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={filtered.length}
                onPageChange={(next) => setPage({ page: next })}
              />
            </>
          )}
        </div>
      )}

      {browsing && (
        <InstanceBrowseDialog
          key={browsing.id}
          instanceId={browsing.id}
          instanceName={browsing.name}
          open
          onOpenChange={(open) => {
            if (!open) setBrowsing(null);
          }}
        />
      )}
      <ArchiveInstanceDialog
        instance={archiving}
        onClose={() => setArchiving(null)}
      />
    </>
  );
}

/** 实例表表头；加载中与加载后共用。
 * @returns 表头。
 * @throws 不适用。
 */
function InstancesTableHead() {
  const { t } = useTranslation('instances');
  return (
    <THead>
      <tr>
        <TH className="w-32">{t('list.columns.status')}</TH>
        <TH>{t('list.columns.name')}</TH>
        <TH>{t('list.columns.address')}</TH>
        <TH className="hidden lg:table-cell">{t('list.columns.auth')}</TH>
        <TH className="hidden xl:table-cell">{t('list.columns.download')}</TH>
        <TH>{t('list.columns.version')}</TH>
        <TH className="text-right">{t('list.columns.jobs')}</TH>
        <TH>{t('list.columns.tested')}</TH>
        <TH className="text-right">
          <span className="sr-only">{t('list.columns.actions')}</span>
        </TH>
      </tr>
    </THead>
  );
}

/** 单行属性。 */
interface InstanceRowProps {
  /** 实例。 */
  instance: Instance;
  /** 引用它的任务数；任务目录未加载时为 null。 */
  jobs: number | null;
  /** 本行是否正在测试。 */
  testing: boolean;
  /** 是否有任意实例正在测试。 */
  testBusy: boolean;
  /** 测试连接。 */
  onTest: () => void;
  /** 打开浏览对话框。 */
  onBrowse: () => void;
  /** 打开归档确认框。 */
  onArchive: () => void;
}

/** 渲染实例表格的一行。
 * @param props 实例、引用数与行内操作。
 * @returns 表格行。
 * @throws 不适用。
 */
function InstanceRow({
  instance,
  jobs,
  testing,
  testBusy,
  onTest,
  onBrowse,
  onArchive,
}: InstanceRowProps) {
  const { t } = useTranslation(['instances', 'common']);
  const errorText = useErrorText();
  const authLabel = useAuthLabel();
  const version = shortVersion(instance.openlistVersion);
  const blocked = instance.authState === 'auth_blocked';
  const error = instance.lastError
    ? errorText(instance.lastError.code, instance.lastError.message)
    : null;
  return (
    <TR>
      <TD>
        <Tip content={error}>
          <span tabIndex={error ? 0 : undefined} className="inline-flex">
            <InstanceHealthBadge instance={instance} />
          </span>
        </Tip>
      </TD>
      <TD className="max-w-48">
        <Link
          to={`/instances/${instance.id}`}
          className="block truncate font-medium hover:underline"
        >
          {instance.name}
        </Link>
      </TD>
      <TD className="max-w-64">
        <PathText path={instance.baseUrl} className="text-muted-foreground" />
      </TD>
      <TD className="hidden whitespace-nowrap lg:table-cell">
        {authLabel(instance)}
      </TD>
      <TD className="hidden whitespace-nowrap xl:table-cell">
        {t(`download.${instance.downloadMode}`)}
      </TD>
      <TD className="whitespace-nowrap">
        {version ? (
          <span title={instance.openlistVersion ?? undefined}>{version}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TD>
      <TD className="text-right">
        {jobs === null ? (
          <span className="text-muted-foreground" title={t('list.jobsUnknown')}>
            —
          </span>
        ) : (
          jobs
        )}
      </TD>
      <TD className="whitespace-nowrap">
        {instance.lastTestAt ? (
          <RelativeTime iso={instance.lastTestAt} />
        ) : (
          <span className="text-muted-foreground">{t('list.neverTested')}</span>
        )}
      </TD>
      <TD>
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" onClick={onTest} disabled={testBusy}>
            {testing
              ? t('actions.testing')
              : blocked
                ? t('actions.retryAuth')
                : t('actions.test')}
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('common:actions.more')}
              >
                <MoreHorizontal size={15} aria-hidden="true" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem asChild>
                <Link to={`/instances/${instance.id}/edit`}>
                  {t('actions.edit')}
                </Link>
              </MenuItem>
              <MenuItem onSelect={onBrowse}>{t('actions.browse')}</MenuItem>
              <MenuItem asChild>
                <Link to={`/operations?instanceId=${instance.id}`}>
                  {t('actions.operations')}
                </Link>
              </MenuItem>
              <MenuSeparator />
              <MenuItem danger onSelect={onArchive}>
                {t('actions.archive')}
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </TD>
    </TR>
  );
}
