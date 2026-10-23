// 任务创建/编辑表单：编辑式分节组织全部配置，顶栏与底部都可提交；校验文案随语言切换。
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { PageHeader } from '../../components/page-header';
import { Magnetic } from '../../components/motion/magnetic';
import { Button } from '../../components/ui/button';
import { ErrorState, LoadingState } from '../../components/states';
import { useCreateJob, usePatchJob, useInstanceOptions } from './job-queries';
import {
  applyBrowsedPath,
  buildJobInput,
  emptyTarget,
  JobFormError,
  jobValidationText,
  targetsFromJob,
  targetCreateModeState,
} from './job-form-model';
import type { JobFormValues } from './job-form-model';
import {
  AdvancedFields,
  BasicsFields,
  FilterFields,
  ScheduleFields,
  SourceFields,
} from './job-form-sections';
import type { UpdateField } from './job-form-sections';
import { TargetsFields } from './job-target-fields';
import type { JobView } from './job-contract';
import { InstanceBrowseDialog } from '../instances/instance-browse-dialog';

const FORM_ID = 'job-form';

/** 由已有任务（编辑）或后端默认值（新建）生成初始表单值。
 * @param existing 已有任务；新建时为 undefined。
 * @returns 表单值。
 * @throws 不适用。
 */
function initialValues(existing?: JobView): JobFormValues {
  return {
    name: existing?.name ?? '',
    sourceInstanceId: existing?.source.instanceId ?? '',
    sourcePath: existing?.source.path ?? '/',
    sourcePassword: '',
    sourceRefresh: existing?.source.refresh ?? false,
    sourceDownloadConcurrency:
      existing?.sourceDownloadConcurrency.toString() ?? '2',
    targets: existing ? targetsFromJob(existing) : [emptyTarget()],
    cron: existing?.cron ?? '',
    timezone: existing?.timezone ?? 'UTC',
    includePatterns: existing?.filters.include.join('\n') ?? '',
    excludePatterns: existing?.filters.exclude.join('\n') ?? '',
    minSizeBytes: existing?.filters.minSizeBytes?.toString() ?? '',
    maxSizeBytes: existing?.filters.maxSizeBytes?.toString() ?? '',
    allowEmptySource: existing?.allowEmptySource ?? false,
    syncEmptyDirs: existing?.syncEmptyDirs ?? false,
    retryCount: existing?.retryCount?.toString() ?? '',
    relayBandwidthLimit: existing?.relayBandwidthLimit?.toString() ?? '0',
    timeoutSeconds: existing?.timeoutSeconds?.toString() ?? '86400',
  };
}

/** 渲染提交按钮内容（进行中显示旋转图标）。
 * @param props pending 是否提交中；isEdit 是否编辑。
 * @returns 按钮内容。
 * @throws 不适用。
 */
function SubmitLabel({
  pending,
  isEdit,
}: {
  pending: boolean;
  isEdit: boolean;
}) {
  const { t } = useTranslation('jobs');
  if (pending)
    return (
      <>
        {isEdit ? t('form.saving') : t('form.creating')}
        <LoaderCircle
          size={15}
          className="motion-safe:animate-spin"
          aria-hidden="true"
        />
      </>
    );
  return (
    <>
      {isEdit ? t('form.submitSave') : t('form.submitCreate')}
      <ArrowUpRight size={15} aria-hidden="true" />
    </>
  );
}

/** 任务表单。
 * @param props 可选已有任务（编辑模式）。
 * @returns 表单页面。
 * @throws 不适用。
 */
export function JobForm({ existing }: { existing?: JobView }) {
  const { t } = useTranslation(['jobs', 'common']);
  const navigate = useNavigate();
  const create = useCreateJob();
  const patch = usePatchJob(existing?.id ?? '');
  const instances = useInstanceOptions();
  const isEdit = !!existing;
  const mutation = isEdit ? patch : create;
  const [values, setValues] = useState<JobFormValues>(() =>
    initialValues(existing),
  );
  const [validationError, setValidationError] = useState<Error | null>(null);
  // 目录选择器当前服务的端点：'source' 为源，数字为目标位置，null 为关闭。
  const [browsing, setBrowsing] = useState<'source' | number | null>(null);
  const invalidTargetMode = values.targets.some(
    (target) => targetCreateModeState(values.sourceInstanceId, target).invalid,
  );
  const backTo = isEdit ? `/jobs/${existing.id}` : '/jobs';

  const update: UpdateField = (field, value) =>
    setValues((previous) => ({ ...previous, [field]: value }));

  /** 本地校验后提交；校验失败时只保存错误键，渲染时按当前语言生成文案。
   * @param event 表单事件。
   * @returns 不适用。
   * @throws 不适用。
   */
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending || !instances.data || invalidTargetMode) return;
    try {
      const body = buildJobInput(values);
      setValidationError(null);
      mutation.mutate(body, {
        onSuccess: (data) => {
          void navigate(`/jobs/${data.id}`);
        },
      });
    } catch (failure) {
      setValidationError(
        failure instanceof Error ? failure : new Error(t('form.invalid')),
      );
    }
  }

  const instanceList = instances.data ?? [];
  const shownValidationError =
    validationError instanceof JobFormError
      ? new Error(
          jobValidationText(validationError.key, validationError.params, t),
        )
      : validationError;
  const submitDisabled =
    mutation.isPending || !instances.data || invalidTargetMode;
  // 选择器的实例、起始路径与密码都取自该端点在表单中的当前值。
  const browseEndpoint =
    browsing === 'source'
      ? {
          instanceId: values.sourceInstanceId,
          path: values.sourcePath,
          password: values.sourcePassword,
        }
      : browsing === null
        ? undefined
        : values.targets[browsing];
  const browseInstance =
    browseEndpoint &&
    instanceList.find((item) => item.id === browseEndpoint.instanceId);

  return (
    <section>
      <PageHeader
        index="03"
        kicker={isEdit ? t('form.kickerEdit') : t('form.kickerNew')}
        title={isEdit ? existing.name : undefined}
        description={
          isEdit ? t('form.descriptionEdit') : t('form.descriptionNew')
        }
        meta={
          <Link
            to={backTo}
            className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
          >
            <ArrowLeft size={12} aria-hidden="true" />
            {isEdit ? t('form.backToJob') : t('form.allJobs')}
          </Link>
        }
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to={backTo}>{t('common:actions.cancel')}</Link>
            </Button>
            <Magnetic>
              <Button
                type="submit"
                form={FORM_ID}
                size="sm"
                disabled={submitDisabled}
              >
                <SubmitLabel pending={mutation.isPending} isEdit={isEdit} />
              </Button>
            </Magnetic>
          </>
        }
      />

      {instances.isPending && (
        <LoadingState label={t('form.loadingInstances')} />
      )}
      {instances.isError && (
        <ErrorState
          error={instances.error}
          onRetry={() => {
            void instances.refetch();
          }}
        />
      )}

      <form
        id={FORM_ID}
        onSubmit={handleSubmit}
        aria-label={t('form.formLabel')}
      >
        <BasicsFields values={values} update={update} />
        <SourceFields
          values={values}
          update={update}
          instances={instanceList}
          isEdit={isEdit}
          onBrowse={() => setBrowsing('source')}
        />
        <TargetsFields
          sourceInstanceId={values.sourceInstanceId}
          targets={values.targets}
          instances={instanceList}
          onChange={(targets) => update('targets', targets)}
          onBrowse={(index) => setBrowsing(index)}
        />
        <ScheduleFields values={values} update={update} />
        <FilterFields values={values} update={update} />
        <AdvancedFields values={values} update={update} />

        <div className="space-y-4 border-t border-hairline pt-8">
          {shownValidationError && <ErrorState error={shownValidationError} />}
          {mutation.isError && <ErrorState error={mutation.error} />}
          <div className="flex items-center justify-between gap-4">
            <Button asChild variant="ghost">
              <Link to={backTo}>
                <ArrowLeft size={16} aria-hidden="true" />
                {t('common:actions.cancel')}
              </Link>
            </Button>
            <Button type="submit" disabled={submitDisabled}>
              <SubmitLabel pending={mutation.isPending} isEdit={isEdit} />
            </Button>
          </div>
        </div>
      </form>
      {browsing !== null && browseEndpoint && browseInstance && (
        <InstanceBrowseDialog
          instanceId={browseInstance.id}
          instanceName={browseInstance.name}
          open
          onOpenChange={(open) => {
            if (!open) setBrowsing(null);
          }}
          initialPath={browseEndpoint.path || '/'}
          initialPassword={browseEndpoint.password}
          onSelect={(path, password) => {
            setValues((previous) =>
              applyBrowsedPath(previous, browsing, path, password),
            );
            setBrowsing(null);
          }}
        />
      )}
    </section>
  );
}
