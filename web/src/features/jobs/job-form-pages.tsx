// 新建与编辑任务的路由页：编辑页先读取任务配置，加载与错误在原位显示，然后交给共享表单。
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader, useDocumentTitle } from '../../components/page';
import { ErrorState, LoadingState, StaleNotice } from '../../components/states';
import { Button } from '../../components/ui/button';
import { JobForm } from './job-form';
import { useJob } from './job-queries';

/** 新建任务页。
 * @returns 空白表单。
 * @throws 不适用。
 */
export function JobCreatePage() {
  const { t } = useTranslation('jobs');
  useDocumentTitle(t('form.titleNew'), t('list.title'));
  return <JobForm />;
}

/** 编辑任务页；以任务 ID 作为表单 key，切换任务时重新初始化表单值。
 * @returns 已填充的表单，或加载/错误状态。
 * @throws 不适用。
 */
export function JobEditPage() {
  const { t } = useTranslation('jobs');
  const { id = '' } = useParams();
  const job = useJob(id);
  useDocumentTitle(
    job.data ? t('form.titleEdit', { name: job.data.name }) : undefined,
    t('list.title'),
  );

  if (job.isPending)
    return (
      <section className="mx-auto max-w-4xl">
        <PageHeader
          back={{ to: `/jobs/${id}`, label: t('form.backToJob') }}
          title={t('form.loadingJob')}
        />
        <LoadingState label={t('form.loadingJob')} rows={6} />
      </section>
    );
  if (job.isError && !job.data)
    return (
      <section className="mx-auto max-w-4xl space-y-3">
        <ErrorState
          error={job.error}
          onRetry={() => {
            void job.refetch();
          }}
        />
        <Button asChild>
          <Link to="/jobs">{t('detail.notFound')}</Link>
        </Button>
      </section>
    );
  return (
    <>
      <StaleNotice show={job.isRefetchError} />
      {job.data && <JobForm key={job.data.id} existing={job.data} />}
    </>
  );
}
