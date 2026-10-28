// 单条文件操作页面：可直接通过链接打开，不依赖先加载所属运行；未完成时自动刷新。
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader, useDocumentTitle } from '../../components/page';
import { Skeleton, TitleSkeleton } from '../../components/skeleton';
import { ErrorState } from '../../components/states';
import { OperationStatusBadge } from '../../components/status';
import { Badge } from '../../components/ui/badge';
import { useOperation } from './operation-queries';
import {
  OperationDetails,
  OperationDetailsSkeleton,
  pathName,
} from './operation-details';

/** 渲染操作详情页面。
 * @returns 页头与操作详情。
 * @throws 不适用；请求错误在页面内显示。
 */
export function OperationDetailPage() {
  const { t } = useTranslation(['operations', 'common']);
  const { id = '' } = useParams();
  const operation = useOperation(id);
  const data = operation.data;
  useDocumentTitle(
    data ? pathName(data.targetPath) : t('detail.title'),
    t('common:nav.operations'),
  );

  if (!data)
    return operation.isError ? (
      <section>
        <PageHeader title={t('detail.title')} />
        <ErrorState
          error={operation.error}
          onRetry={() => void operation.refetch()}
        />
      </section>
    ) : (
      <section className="max-w-4xl">
        <PageHeader
          title={<TitleSkeleton />}
          badges={
            <>
              <Skeleton className="h-5 w-14" />
              <Skeleton className="h-5 w-12" />
            </>
          }
        />
        <OperationDetailsSkeleton label={t('detail.loading')} />
      </section>
    );

  return (
    <section className="max-w-4xl">
      <PageHeader
        title={<span translate="no">{pathName(data.targetPath)}</span>}
        badges={
          <>
            <OperationStatusBadge status={data.status} />
            <Badge>{t(`common:operationAction.${data.action}`)}</Badge>
            {data.action === 'create' && (
              <Badge>{t(`common:operationMethod.${data.method}`)}</Badge>
            )}
          </>
        }
        back={{ to: `/runs/${data.runId}`, label: t('detail.backRun') }}
      />
      {operation.isRefetchError && (
        <p role="status" className="mb-2 text-xs text-warning">
          {t('common:states.stale')}
        </p>
      )}
      <OperationDetails operation={data} />
    </section>
  );
}
