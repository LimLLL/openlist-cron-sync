// 实例列表页：编辑式页头、状态统计条与编号列表，新建入口进入固定顶栏。
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../components/page-header';
import { Magnetic } from '../../components/motion/magnetic';
import { CountUp } from '../../components/motion/count-up';
import { Button } from '../../components/ui/button';
import { IndexHead, IndexList, IndexRow } from '../../components/ui/index-list';
import { Pagination } from '../../components/ui/pagination';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { usePageParams } from '../../lib/hooks';
import { formatRelative, formatTimeFull } from '../../lib/format';
import { useErrorText } from '../../i18n/error-text';
import { useInstances } from './instance-queries';
import { instanceStatus, InstanceStatusBadge, shortVersion } from './instance-display';
import type { Instance } from './instance-contract';

/** 渲染新建实例按钮；同一元素同时用于顶栏和空状态。
 * @param props label 按钮文字。
 * @returns 带磁吸效果的链接按钮。
 * @throws 不适用。
 */
function NewInstanceButton({ label }: { label: string }) {
  return (
    <Magnetic>
      <Button asChild size="sm">
        <Link to="/instances/new">
          <Plus size={15} aria-hidden="true" />
          {label}
        </Link>
      </Button>
    </Magnetic>
  );
}

/** 渲染状态统计条；只有当前页包含全部实例时才统计就绪与待处理，避免以一页数据冒充全局。
 * @param props items 当前页实例；total 实例总数。
 * @returns 发丝线分隔的大数字统计。
 * @throws 不适用。
 */
function StatStrip({ items, total }: { items: Instance[]; total: number }) {
  const { t } = useTranslation('instances');
  const complete = items.length === total;
  const ready = items.filter((item) => instanceStatus(item) === 'ready').length;
  const stats = [
    { label: t('list.stats.total'), value: total, tone: 'text-foreground' },
    ...(complete
      ? [
          { label: t('list.stats.ready'), value: ready, tone: 'text-accent' },
          { label: t('list.stats.attention'), value: total - ready, tone: total - ready > 0 ? 'text-signal' : 'text-muted-foreground' },
        ]
      : []),
  ];
  return (
    <dl className="mb-12 grid grid-cols-3 border-y border-hairline">
      {stats.map((stat, position) => (
        <div key={stat.label} className={position > 0 ? 'border-l border-hairline py-6 pl-6' : 'py-6'}>
          <dt className="eyebrow">{stat.label}</dt>
          <dd className={`stat-figure mt-3 ${stat.tone}`}>
            <CountUp value={stat.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 渲染单行实例条目。
 * @param props instance 实例；index 序号。
 * @returns 编号行。
 * @throws 不适用。
 */
function InstanceRow({ instance, index }: { instance: Instance; index: number }) {
  const { t } = useTranslation('instances');
  const errorText = useErrorText();
  return (
    <IndexRow
      to={`/instances/${instance.id}`}
      index={index}
      title={instance.name}
      subtitle={
        instance.lastError ? (
          <>
            <span>{instance.baseUrl}</span>
            <span className="ml-3 text-signal">
              {errorText(instance.lastError.code, instance.lastError.message)}
            </span>
          </>
        ) : (
          instance.baseUrl
        )
      }
      cells={[
        instance.auth.mode === 'token'
          ? t('form.modeToken')
          : `${t('form.modePassword')} · ${instance.auth.username ?? ''}`,
        shortVersion(instance.openlistVersion) ?? '—',
        <span key="tested" title={formatTimeFull(instance.lastTestAt)}>
          {instance.lastTestAt ? formatRelative(instance.lastTestAt) : t('list.neverTested')}
        </span>,
      ]}
      status={<InstanceStatusBadge instance={instance} />}
    />
  );
}

/** 渲染实例列表页。
 * @returns 分页实例列表。
 * @throws 不适用。
 */
export function InstancesPage() {
  const { t } = useTranslation(['instances', 'common']);
  const { page, pageSize, setPage } = usePageParams({ page: 1, pageSize: 20 });
  const query = useInstances(page, pageSize);
  const data = query.data;

  return (
    <section>
      <PageHeader
        index="02"
        kicker={t('common:nav.instances')}
        description={t('list.description')}
        meta={data ? t('list.count', { count: data.total }) : undefined}
        actions={<NewInstanceButton label={t('list.newInstance')} />}
      />

      {query.isPending && <LoadingState label={t('list.loading')} rows={5} />}
      {query.isError && (
        <ErrorState
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      )}

      {data && data.items.length === 0 && (
        <>
          <EmptyState
            title={t('list.emptyTitle')}
            description={t('list.emptyDescription')}
            action={<NewInstanceButton label={t('list.create')} />}
          />
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPageChange={(next) => setPage({ page: next })}
            className="mt-6"
          />
        </>
      )}

      {data && data.items.length > 0 && (
        <>
          <StatStrip items={data.items} total={data.total} />
          <IndexHead
            title={t('list.columns.name')}
            cells={[t('list.columns.auth'), t('list.columns.version'), t('list.columns.tested')]}
            status={t('list.columns.status')}
          />
          <IndexList>
            {data.items.map((instance, position) => (
              <InstanceRow
                key={instance.id}
                instance={instance}
                index={(data.page - 1) * data.pageSize + position + 1}
              />
            ))}
          </IndexList>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={(next) => setPage({ page: next })}
            className="mt-8"
          />
        </>
      )}
    </section>
  );
}
