// 运行详情的“操作”标签：按动作与状态筛选（写进 URL、独立分页），点击“详情”在右侧面板查看单条操作（?op= 可直接分享）。
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  StaleNotice,
  TableSkeleton,
} from '../../components/states';
import { OperationStatusBadge } from '../../components/status';
import { Endpoint, RelativeTime } from '../../components/text';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Dialog, SheetContent } from '../../components/ui/dialog';
import { NativeSelect } from '../../components/ui/input';
import { Pagination } from '../../components/ui/pagination';
import { Segmented } from '../../components/ui/segmented';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/table';
import {
  useClearFilters,
  useFilterParam,
  usePageParams,
} from '../../lib/hooks';
import { OPERATION_STATUSES } from '../operations/operation-contract';
import { useOperation } from '../operations/operation-queries';
import {
  OperationDetails,
  OperationSize,
  pathName,
} from '../operations/operation-details';
import { isActiveRun, useRunOperations } from './run-queries';
import type { RunDetail } from './run-contract';

const ACTIONS = ['mkdir', 'create', 'delete'] as const;
const OP_PARAM = 'op';

/** 右侧面板：读取并显示单条操作；关闭时不再请求。
 * @returns 由op查询参数控制的面板，可在任意详情标签页直接打开。
 * @throws 不适用。
 */
export function OperationSheet() {
  const [params, setParams] = useSearchParams();
  const id = params.get(OP_PARAM) ?? '';
  const onClose = () =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(OP_PARAM);
        return next;
      },
      { replace: true },
    );
  const { t } = useTranslation(['runs', 'operations', 'common']);
  const open = id !== '';
  const operation = useOperation(id, open);
  const data = operation.data;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {open && (
        <SheetContent
          title={
            data ? (
              <span translate="no">{pathName(data.targetPath)}</span>
            ) : (
              t('operations:detail.title')
            )
          }
          description={
            data ? (
              <span className="inline-flex items-center gap-1.5">
                <OperationStatusBadge status={data.status} />
                {t(`common:operationAction.${data.action}`)}
              </span>
            ) : undefined
          }
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link to={`/operations/${id}`}>{t('operations.openPage')}</Link>
            </Button>
          }
        >
          <StaleNotice show={operation.isRefetchError} />
          {data ? (
            <OperationDetails operation={data} />
          ) : operation.isError ? (
            <ErrorState
              error={operation.error}
              onRetry={() => void operation.refetch()}
            />
          ) : (
            <LoadingState rows={6} label={t('operations:detail.loading')} />
          )}
        </SheetContent>
      )}
    </Dialog>
  );
}

/** 渲染运行的操作表与筛选。
 * @param props run 运行详情。
 * @returns 操作标签内容。
 * @throws 不适用；请求错误在标签内显示。
 */
export function RunOperationsTab({ run }: { run: RunDetail }) {
  const { t } = useTranslation(['runs', 'common']);
  const { page, pageSize, setPage } = usePageParams(
    { page: 1, pageSize: 50 },
    'ops',
  );
  const [rawStatus, setStatus] = useFilterParam('opStatus', 'opsPage');
  const [rawAction, setAction] = useFilterParam('opAction', 'opsPage');
  const clearFilters = useClearFilters(['opStatus', 'opAction'], 'opsPage');
  const status = OPERATION_STATUSES.some((value) => value === rawStatus)
    ? rawStatus
    : undefined;
  const action = ACTIONS.some((value) => value === rawAction)
    ? rawAction
    : undefined;
  const operations = useRunOperations(
    run.id,
    { page, pageSize, status, action },
    isActiveRun(run.status),
  );
  const [, setSearchParams] = useSearchParams();
  const data = operations.data;
  const filtered = Boolean(status || action);

  /** 打开或关闭操作面板，保留其他 URL 参数。
   * @param id 操作 ID；null 关闭。
   * @returns 不适用。
   * @throws 不适用。
   */
  const showOperation = (id: string | null) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (id) params.set(OP_PARAM, id);
        else params.delete(OP_PARAM);
        return params;
      },
      { replace: true },
    );
  };

  return (
    <div>
      <div
        role="group"
        aria-label={t('operations.filters')}
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        <Segmented
          label={t('operations.actionFilter')}
          value={action ?? ''}
          onChange={(value) => setAction(value || undefined)}
          options={[
            { value: '', label: t('operations.allActions') },
            ...ACTIONS.map((value) => ({
              value,
              label: t(`common:operationAction.${value}`),
            })),
          ]}
        />
        <NativeSelect
          aria-label={t('operations.statusFilter')}
          value={status ?? ''}
          onChange={(event) => setStatus(event.target.value || undefined)}
          className="w-40"
        >
          <option value="">{t('operations.allStatuses')}</option>
          {OPERATION_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`common:operationStatus.${value}`)}
            </option>
          ))}
        </NativeSelect>
        {data && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {t('operations.total', { count: data.total })}
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
          <TableSkeleton columns={7} label={t('operations.loading')} />
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
              title={t('operations.emptyTitle')}
              description={
                run.scanCompletedAt
                  ? t('operations.emptyDescription')
                  : t('operations.emptyScanning')
              }
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
            <THead>
              <tr>
                <TH className="w-14 text-right">
                  {t('operations.columns.seq')}
                </TH>
                <TH className="w-32">{t('operations.columns.action')}</TH>
                <TH className="w-28">{t('operations.columns.status')}</TH>
                <TH>{t('operations.columns.target')}</TH>
                <TH className="w-24 text-right">
                  {t('operations.columns.size')}
                </TH>
                <TH className="w-20">{t('operations.columns.attempt')}</TH>
                <TH className="w-28">{t('operations.columns.ended')}</TH>
                <TH className="w-16">
                  <span className="sr-only">{t('operations.details')}</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {data.items.map((operation) => (
                <TR key={operation.id}>
                  <TD className="text-right font-mono text-xs text-muted-foreground">
                    {operation.seq}
                  </TD>
                  <TD className="text-[13px] whitespace-nowrap">
                    {t(`common:operationAction.${operation.action}`)}
                    {operation.action === 'create' && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {t(`common:operationMethod.${operation.method}`)}
                      </span>
                    )}
                  </TD>
                  <TD>
                    <OperationStatusBadge status={operation.status} />
                  </TD>
                  <TD className="max-w-96">
                    <Endpoint
                      instance={operation.targetInstanceName}
                      path={operation.targetPath}
                    />
                  </TD>
                  <TD className="text-right">
                    <OperationSize
                      operation={operation}
                      directory={t('operations.directory')}
                    />
                  </TD>
                  <TD className="whitespace-nowrap">
                    <span className="tabular-nums">{operation.attemptNo}</span>
                    {operation.retryOf && (
                      <Badge className="ml-1.5">{t('operations.retry')}</Badge>
                    )}
                  </TD>
                  <TD>
                    <RelativeTime iso={operation.endedAt} />
                  </TD>
                  <TD>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => showOperation(operation.id)}
                    >
                      {t('operations.details')}
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
    </div>
  );
}
