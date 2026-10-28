// 新建与编辑实例页面：共用表单；新建成功进入新实例详情，编辑成功回到该实例详情。
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader, useDocumentTitle } from '../../components/page';
import {
  FormSkeleton,
  Skeleton,
  TitleSkeleton,
} from '../../components/skeleton';
import { ErrorState, StaleNotice } from '../../components/states';
import { toast } from '../../components/ui/toast';
import { InstanceForm } from './instance-form';
import {
  useCreateInstance,
  useInstance,
  useUpdateInstance,
} from './instance-queries';

/** 渲染新建实例页面。
 * @returns 页面。
 * @throws 不适用；请求错误显示在表单内。
 */
export function InstanceCreatePage() {
  const { t } = useTranslation('instances');
  const navigate = useNavigate();
  const create = useCreateInstance();
  useDocumentTitle(t('form.createTitle'), t('list.title'));
  return (
    <>
      <PageHeader
        back={{ to: '/instances', label: t('form.back') }}
        title={t('form.createTitle')}
        description={t('form.createDescription')}
      />
      <InstanceForm
        pending={create.isPending}
        error={create.error}
        onCancel={() => navigate('/instances')}
        onSubmit={(body) =>
          create.mutate(body, {
            onSuccess: (data) => {
              toast({ title: t('form.created', { name: data.name }) });
              navigate(`/instances/${data.id}`);
            },
          })
        }
      />
    </>
  );
}

/** 渲染编辑实例页面。
 * @returns 页面。
 * @throws 不适用；加载与请求错误就地显示。
 */
export function InstanceEditPage() {
  const { t } = useTranslation('instances');
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useInstance(id);
  const update = useUpdateInstance(id);
  useDocumentTitle(
    query.data ? t('form.editTitle', { name: query.data.name }) : undefined,
    t('list.title'),
  );
  const back = { to: `/instances/${id}`, label: query.data?.name ?? '' };

  const instance = query.data;
  if (!instance)
    return query.isError ? (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <>
        <PageHeader
          back={{
            to: back.to,
            label: <Skeleton className="h-3 w-16" />,
          }}
          title={<TitleSkeleton />}
          description={t('form.editDescription')}
        />
        <FormSkeleton
          label={t('form.loading')}
          className="max-w-2xl"
          sections={[
            { title: t('form.sections.identity'), fields: 2 },
            {
              title: t('form.sections.auth'),
              description: t('form.sections.authHint'),
              fields: 3,
            },
            { title: t('form.sections.transfer'), fields: 1, wide: true },
          ]}
        />
      </>
    );

  return (
    <>
      <PageHeader
        back={back}
        title={t('form.editTitle', { name: instance.name })}
        description={t('form.editDescription')}
      />
      <StaleNotice show={query.isRefetchError} />
      <InstanceForm
        key={instance.id}
        instance={instance}
        pending={update.isPending}
        error={update.error}
        onCancel={() => navigate(`/instances/${id}`)}
        onSubmit={(body) =>
          update.mutate(body, {
            onSuccess: (data) => {
              toast({ title: t('form.saved', { name: data.name }) });
              navigate(`/instances/${data.id}`);
            },
          })
        }
      />
    </>
  );
}
