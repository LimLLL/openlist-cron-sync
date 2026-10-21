// 创建和编辑路由负责读取配置，表单负责校验与提交。
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useJob } from './job-queries';
import { JobForm } from './job-form';
import { ErrorState, LoadingState } from '../../components/states';

/** 渲染任务创建页面。
 * @returns 创建表单。
 * @throws 不适用。
 */
export function JobCreatePage() {
  return <JobForm />;
}

/** 渲染任务编辑页面。
 * @returns 编辑表单或原位加载/错误状态。
 * @throws 不适用。
 */
export function JobEditPage() {
  const { t } = useTranslation('jobs');
  const { id } = useParams<{ id: string }>();
  const job = useJob(id!);
  if (job.isPending) return <LoadingState label={t('form.loadingJob')} rows={6} />;
  if (job.isError)
    return (
      <ErrorState
        error={job.error}
        onRetry={() => {
          void job.refetch();
        }}
      />
    );
  return <JobForm key={job.data.id} existing={job.data} />;
}
