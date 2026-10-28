// 任务创建/编辑表单：分区填写全部配置，底部吸附操作栏显示校验错误与保存；校验文案在渲染时按当前语言生成。
import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/page';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { Button } from '../../components/ui/button';
import { InstanceBrowseDialog } from '../instances/instance-browse-dialog';
import { useInstanceCatalog } from '../instances/instance-queries';
import { useCreateJob, usePatchJob } from './job-queries';
import {
  applyBrowsedPath,
  buildJobInput,
  emptyTarget,
  JobFormError,
  jobValidationText,
  targetCreateModeState,
  targetsFromJob,
} from './job-form-model';
import type { JobFormValues } from './job-form-model';
import {
  AdvancedFields,
  BasicsFields,
  FilterFields,
  ScheduleFields,
  SourceFields,
} from './job-form-fields';
import type { UpdateField } from './job-form-fields';
import { TargetsFields } from './job-target-fields';
import type { JobView } from './job-contract';

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
    sourceScanIntervalSeconds:
      existing?.sourceScanIntervalSeconds.toString() ?? '0',
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
    relayBandwidthLimit: existing?.relayBandwidthLimit.toString() ?? '0',
    timeoutSeconds: existing?.timeoutSeconds.toString() ?? '86400',
  };
}

/** 任务表单；新建或编辑由 existing 决定，成功后进入任务详情。
 * @param props existing 编辑模式下的已有任务。
 * @returns 表单页面。
 * @throws 不适用；请求与校验错误显示在底部操作栏。
 */
export function JobForm({ existing }: { existing?: JobView }) {
  const { t } = useTranslation(['jobs', 'common']);
  const navigate = useNavigate();
  const create = useCreateJob();
  const patch = usePatchJob(existing?.id ?? '');
  const instances = useInstanceCatalog();
  const isEdit = existing !== undefined;
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
   * @param event 表单提交事件。
   * @returns 不适用。
   * @throws 不适用。
   */
  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
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
    <section className="mx-auto max-w-4xl">
      <PageHeader
        back={{
          to: backTo,
          label: isEdit ? t('form.backToJob') : t('form.allJobs'),
        }}
        title={
          isEdit
            ? t('form.titleEdit', { name: existing.name })
            : t('form.titleNew')
        }
        description={isEdit ? t('form.editNotice') : undefined}
      />

      {instances.isPending && (
        <LoadingState label={t('form.loadingInstances')} className="mb-4" />
      )}
      {instances.isError && (
        <div className="mb-4">
          <ErrorState
            error={instances.error}
            onRetry={() => {
              void instances.refetch();
            }}
          />
        </div>
      )}
      {!isEdit && instances.data?.length === 0 && (
        <div className="mb-4">
          <EmptyState
            title={t('form.noInstances')}
            action={
              <Button asChild variant="primary">
                <Link to="/instances/new">{t('form.addInstance')}</Link>
              </Button>
            }
          />
        </div>
      )}

      {/* 校验统一由 buildJobInput 完成并显示本地化错误；折叠的高级设置里的原生校验会静默阻止提交。 */}
      <form
        noValidate
        onSubmit={handleSubmit}
        aria-label={t('form.formLabel')}
        className="space-y-4"
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

        {/* 底部吸附操作栏：长表单任何位置都能看到错误并保存。 */}
        <div className="sticky bottom-0 z-10 -mb-5 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 py-3 backdrop-blur lg:-mb-6">
          <div className="min-w-0 flex-1 space-y-2">
            {shownValidationError && (
              <ErrorState error={shownValidationError} compact />
            )}
            {mutation.isError && <ErrorState error={mutation.error} compact />}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button asChild>
              <Link to={backTo}>{t('common:actions.cancel')}</Link>
            </Button>
            <Button type="submit" variant="primary" disabled={submitDisabled}>
              {mutation.isPending
                ? isEdit
                  ? t('form.saving')
                  : t('form.creating')
                : isEdit
                  ? t('form.submitSave')
                  : t('form.submitCreate')}
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
