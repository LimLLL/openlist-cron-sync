// 跨运行的文件操作列表（从实例详情进入，用于排查某实例上失败或结果未知的文件）：按实例与状态筛选，筛选写进 URL。
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader, useDocumentTitle } from '../../components/page';
import { TableSkeleton } from '../../components/skeleton';
import { EmptyState, ErrorState } from '../../components/states';
import { OperationStatusBadge } from '../../components/status';
import { Endpoint, RelativeTime, ShortId } from '../../components/text';
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
import { useInstanceCatalog } from '../instances/instance-queries';
import { OPERATION_STATUSES } from './operation-contract';
import { useOperations } from './operation-queries';
import { OperationSize } from './operation-details';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 操作表表头；加载中与加载后共用。
 * @returns 表头。
 * @throws 不适用。
 */
function OperationsTableHead() {
  const { t } = useTranslation('operations');
  return (
    <THead>
      <tr>
        <TH className="w-28">{t('list.columns.status')}</TH>
        <TH className="w-24">{t('list.columns.action')}</TH>
        <TH>{t('list.columns.target')}</TH>
        <TH>{t('list.columns.source')}</TH>
        <TH className="w-24 text-right">{t('list.columns.size')}</TH>
        <TH className="w-24">{t('list.columns.run')}</TH>
        <TH className="w-28">{t('list.columns.created')}</TH>
        <TH className="w-16">
          <span className="sr-only">{t('list.open')}</span>
        </TH>
      </tr>
    </THead>
  );
}

/** 渲染跨运行操作列表页面。
 * @returns 带筛选与分页的操作表格。
 * @throws 不适用；请求错误在页面内显示。
 */
export function OperationsPage() {
  const { t } = useTranslation(['operations', 'common']);
  useDocumentTitle(t('list.title'));
  const { page, pageSize, setPage } = usePageParams();
  const [rawInstanceId, setInstanceId] = useFilterParam('instanceId');
  const [rawStatus, setStatus] = useFilterParam('status');
  const clearFilters = useClearFilters(['instanceId', 'status']);
  const instanceId =
    rawInstanceId && UUID.test(rawInstanceId) ? rawInstanceId : undefined;
  const status = OPERATION_STATUSES.some((value) => value === rawStatus)
    ? rawStatus
    : undefined;
  const operations = useOperations({ page, pageSize, instanceId, status });
  const instances = useInstanceCatalog();
  const data = operations.data;
  const filtered = Boolean(instanceId || status);
  const current = instances.data?.find((item) => item.id === instanceId);

  return (
    <section>
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        back={
          instanceId
            ? {
                to: `/instances/${instanceId}`,
                label: current?.name ?? t('list.backInstance'),
              }
            : { to: '/instances', label: t('list.backInstances') }
        }
      />

      <div
        role="group"
        aria-label={t('list.filters')}
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        <NativeSelect
          aria-label={t('list.instanceFilter')}
          value={instanceId ?? ''}
          onChange={(event) => setInstanceId(event.target.value || undefined)}
          className="w-56"
        >
          <option value="">{t('list.allInstances')}</option>
          {instanceId && !current && (
            <option value={instanceId}>{instanceId.slice(0, 8)}</option>
          )}
          {(instances.data ?? []).map((instance) => (
            <option key={instance.id} value={instance.id}>
              {instance.name}
            </option>
          ))}
        </NativeSelect>
        <Segmented
          label={t('list.statusFilter')}
          value={status ?? ''}
          onChange={(value) => setStatus(value || undefined)}
          options={[
            { value: '', label: t('list.allStatuses') },
            ...OPERATION_STATUSES.map((value) => ({
              value,
              label: t(`common:operationStatus.${value}`),
            })),
          ]}
        />
        {data && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {t('list.total', { count: data.total })}
          </span>
        )}
      </div>

      {operations.isRefetchError && (
        <p role="status" className="mb-2 text-xs text-warning">
          {t('common:states.stale')}
        </p>
      )}

      {!data ? (
        operations.isError ? (
          <ErrorState
            error={operations.error}
            onRetry={() => void operations.refetch()}
          />
        ) : (
          <TableSkeleton
            head={<OperationsTableHead />}
            columns={[
              'badge',
              'text',
              'path',
              'path',
              { kind: 'number', className: 'text-right' },
              'id',
              'time',
              'button',
            ]}
            label={t('list.loading')}
          />
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
            <OperationsTableHead />
            <TBody>
              {data.items.map((operation) => (
                <TR key={operation.id}>
                  <TD>
                    <OperationStatusBadge
                      status={operation.status}
                      attemptCount={operation.attemptCount}
                    />
                  </TD>
                  <TD className="text-[13px] whitespace-nowrap">
                    {t(`common:operationAction.${operation.action}`)}
                  </TD>
                  <TD className="max-w-80">
                    <Endpoint
                      instance={operation.targetInstanceName}
                      path={operation.targetPath}
                    />
                  </TD>
                  <TD className="max-w-72">
                    {operation.sourcePath ? (
                      <Endpoint
                        instance={operation.sourceInstanceName ?? '—'}
                        path={operation.sourcePath}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TD>
                  <TD className="text-right">
                    <OperationSize
                      operation={operation}
                      directory={t('list.directory')}
                    />
                  </TD>
                  <TD>
                    <Link
                      to={`/runs/${operation.runId}`}
                      className="hover:underline"
                    >
                      <ShortId id={operation.runId} />
                    </Link>
                  </TD>
                  <TD>
                    <RelativeTime iso={operation.createdAt} />
                  </TD>
                  <TD>
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/operations/${operation.id}`}>
                        {t('list.open')}
                      </Link>
                    </Button>
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
