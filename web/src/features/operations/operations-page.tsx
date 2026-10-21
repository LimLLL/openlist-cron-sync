// 全局操作列表：编辑式页头、筛选工具条与编号行列表，支持状态与未解决筛选。
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import { Pagination } from '../../components/ui/pagination';
import { Segmented } from '../../components/ui/segmented';
import { IndexHead, IndexList, IndexRow } from '../../components/ui/index-list';
import { PageHeader } from '../../components/page-header';
import { ErrorState, LoadingState, EmptyState } from '../../components/states';
import { usePageParams, useFilterParam } from '../../lib/hooks';
import { formatBytes, formatRelative } from '../../lib/format';
import { useOperations } from './operation-queries';
import { OPERATION_STATUSES } from './operation-contract';
import type { OperationView } from './operation-contract';
import { ACTION_ICONS, splitPath, statusBadge } from './operation-status';

/** 未解决筛选的 URL 取值：空为全部，true 仅未解决，false 排除未解决。 */
type UnresolvedFilter = '' | 'true' | 'false';

/** 渲染全局操作列表页。
 * @returns 操作列表页面。
 * @throws 不适用。
 */
export function OperationsPage() {
  const { page, pageSize, setPage } = usePageParams();
  const [status, setStatus] = useFilterParam('status');
  const [unresolved, setUnresolved] = useFilterParam('unresolved');
  const ops = useOperations({ page, pageSize, status, unresolved });
  const { t } = useTranslation(['operations', 'common']);
  const unresolvedValue: UnresolvedFilter =
    unresolved === 'true' || unresolved === 'false' ? unresolved : '';

  return (
    <section>
      <PageHeader
        index="05"
        kicker={t('common:nav.operations')}
        description={t('list.description')}
        meta={ops.data ? t('list.total', { count: ops.data.total }) : undefined}
      />

      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <Segmented<UnresolvedFilter>
          label={t('list.unresolvedFilter')}
          value={unresolvedValue}
          onChange={(value) => setUnresolved(value || undefined)}
          options={[
            { value: '', label: t('list.unresolvedAll') },
            { value: 'true', label: t('list.unresolvedOnly') },
            { value: 'false', label: t('list.unresolvedExclude') },
          ]}
        />
        <label className="relative inline-flex items-center">
          <span className="sr-only">{t('list.statusFilter')}</span>
          <select
            value={status ?? ''}
            onChange={(event) => setStatus(event.target.value || undefined)}
            className="appearance-none rounded-full border border-hairline bg-white/[0.02] py-2 pr-9 pl-4 text-xs font-medium text-foreground transition-colors hover:border-white/20 focus:border-accent/60 focus:outline-none"
          >
            <option value="">{t('list.allStatuses')}</option>
            {OPERATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`common:operationStatus.${value}`)}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        </label>
      </div>

      {ops.isPending ? (
        <LoadingState label={t('list.loading')} rows={6} />
      ) : ops.isError ? (
        <ErrorState error={ops.error} onRetry={() => void ops.refetch()} />
      ) : ops.data.items.length === 0 ? (
        <>
          <EmptyState title={t('list.emptyTitle')} description={t('list.emptyDescription')} />
          <Pagination
            className="mt-6"
            page={page}
            pageSize={pageSize}
            total={ops.data.total}
            onPageChange={(next) => setPage({ page: next })}
          />
        </>
      ) : (
        <>
          <IndexHead
            title={t('list.columns.target')}
            cells={[t('list.columns.method'), t('list.columns.size'), t('list.columns.created')]}
            status={t('list.columns.status')}
          />
          <IndexList>
            {ops.data.items.map((op, position) => (
              <OperationRow
                key={op.id}
                operation={op}
                index={(ops.data.page - 1) * ops.data.pageSize + position + 1}
              />
            ))}
          </IndexList>
          <Pagination
            className="mt-8"
            page={ops.data.page}
            pageSize={ops.data.pageSize}
            total={ops.data.total}
            onPageChange={(next) => setPage({ page: next })}
          />
        </>
      )}
    </section>
  );
}

/** 渲染一行操作：末段名称为标题，动作与完整目标路径为副信息。
 * @param props operation 操作；index 列表序号。
 * @returns 编号行。
 * @throws 不适用。
 */
function OperationRow({ operation: op, index }: { operation: OperationView; index: number }) {
  const { t } = useTranslation(['operations', 'common']);
  const badge = statusBadge(op.status);
  const Icon = ACTION_ICONS[op.action];
  const { name } = splitPath(op.targetPath);
  const size = op.expectedSourceSize ?? (op.affectedBytes > 0 ? op.affectedBytes : null);
  return (
    <IndexRow
      to={`/operations/${op.id}`}
      index={index}
      title={
        <span className="inline-flex max-w-full items-center gap-2.5">
          <Icon size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{name || op.targetPath}</span>
        </span>
      }
      subtitle={`${t(`common:operationAction.${op.action}`)} · ${op.targetPath}`}
      cells={[
        t(`common:operationMethod.${op.method}`),
        op.isDir ? t('list.directory') : formatBytes(size),
        formatRelative(op.createdAt),
      ]}
      status={
        <Badge variant={badge.variant} pulse={badge.pulse}>
          {t(`common:operationStatus.${op.status}`)}
        </Badge>
      }
    />
  );
}
