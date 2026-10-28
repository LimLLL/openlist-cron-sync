// 运行选项对话框：正式运行/试运行、是否允许超阈值删除；回车即开始，成功后留在当前页并用提示条链接到新运行。
import { useEffect, useRef, useState } from 'react';
import type { SubmitEvent } from 'react';
import { Link } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { ErrorState } from '../../components/states';
import { Button } from '../../components/ui/button';
import { Dialog, DialogClose, DialogContent } from '../../components/ui/dialog';
import { Segmented } from '../../components/ui/segmented';
import { SwitchField } from '../../components/ui/switch';
import { toast } from '../../components/ui/toast';
import { ApiError } from '../../lib/api-client';
import { useTriggerRun } from './job-queries';
import type { JobView } from './job-contract';

/** 运行选项对话框属性。 */
interface JobTriggerDialogProps {
  /** 要运行的任务；为 null 时对话框关闭。 */
  job: Pick<JobView, 'id' | 'name' | 'targets'> | null;
  /** 关闭回调（成功、取消或点遮罩）。 */
  onClose: () => void;
  /** 打开时是否预选试运行。 */
  initialDryRun?: boolean;
}

/** 渲染运行选项对话框；同一时刻只服务一个任务。
 * @param props 任务、关闭回调与预选类型。
 * @returns 对话框。
 * @throws 不适用；请求错误在框内显示。
 */
export function JobTriggerDialog({
  job,
  onClose,
  initialDryRun = false,
}: JobTriggerDialogProps) {
  const { t } = useTranslation('common');
  const trigger = useTriggerRun();
  const [dryRun, setDryRun] = useState(initialDryRun);
  const [confirmDeletes, setConfirmDeletes] = useState(false);
  const jobId = job?.id;
  const { reset } = trigger;
  const submitButton = useRef<HTMLButtonElement>(null);

  // 每次为新任务打开时重置选项与上一次的错误；reset 引用稳定。
  useEffect(() => {
    if (!jobId) return;
    setDryRun(initialDryRun);
    setConfirmDeletes(false);
    reset();
  }, [jobId, initialDryRun, reset]);

  /** 提交运行请求；进行中不重复提交（触发接口没有幂等键）。
   * @param event 表单提交事件。
   * @returns 不适用。
   * @throws 不适用。
   */
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!job || trigger.isPending) return;
    trigger.mutate(
      { jobId: job.id, dryRun, confirmDeletes },
      {
        onSuccess: (run) => {
          onClose();
          toast({
            title: t(dryRun ? 'runDialog.startedDry' : 'runDialog.started', {
              name: job.name,
            }),
            action: { label: t('runDialog.view'), to: `/runs/${run.id}` },
          });
        },
      },
    );
  };

  const error = trigger.error;
  // 网络中断或响应无法解析时运行可能已被接受，提示先核对再重试。
  const ambiguous =
    error instanceof ApiError &&
    (error.code === 'NETWORK_ERROR' || error.code === 'INVALID_RESPONSE');
  const hasMirror = job?.targets.some((target) => target.mode === 'mirror');

  return (
    <Dialog
      open={job !== null}
      onOpenChange={(open) => {
        if (!open && !trigger.isPending) onClose();
      }}
    >
      {job && (
        <DialogContent
          size="sm"
          title={t('runDialog.title', { name: job.name })}
          closeDisabled={trigger.isPending}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            submitButton.current?.focus();
          }}
        >
          <form id="job-trigger-form" onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Segmented
                label={t('runDialog.mode')}
                value={dryRun ? 'dry' : 'real'}
                onChange={(value) => setDryRun(value === 'dry')}
                disabled={trigger.isPending}
                options={[
                  { value: 'real', label: t('runDialog.real') },
                  { value: 'dry', label: t('runDialog.dry') },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                {dryRun ? t('runDialog.dryHint') : t('runDialog.realHint')}
              </p>
            </div>
            {hasMirror && !dryRun && (
              <p className="flex gap-2 rounded-md bg-warning/10 p-2.5 text-xs leading-relaxed text-warning">
                <TriangleAlert
                  size={14}
                  aria-hidden="true"
                  className="mt-px shrink-0"
                />
                {t('runDialog.mirrorWarning')}
              </p>
            )}
            <SwitchField
              id="job-trigger-confirm-deletes"
              label={t('runDialog.confirmDeletes')}
              hint={t('runDialog.confirmDeletesHint')}
              checked={confirmDeletes}
              onCheckedChange={setConfirmDeletes}
              disabled={trigger.isPending}
            />
            {error && (
              <div className="space-y-2">
                <ErrorState error={error} compact />
                {ambiguous && (
                  <p className="text-xs text-muted-foreground">
                    <Trans
                      t={t}
                      i18nKey="runDialog.ambiguous"
                      components={[
                        <Link
                          key="runs"
                          to={`/runs?jobId=${job.id}`}
                          className="text-link hover:underline"
                          onClick={onClose}
                        />,
                      ]}
                    />
                  </p>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <DialogClose asChild>
                <Button disabled={trigger.isPending}>
                  {t('actions.cancel')}
                </Button>
              </DialogClose>
              <Button
                type="submit"
                variant="primary"
                disabled={trigger.isPending}
                ref={submitButton}
              >
                {trigger.isPending
                  ? t('runDialog.submitting')
                  : dryRun
                    ? t('runDialog.submitDry')
                    : t('runDialog.submit')}
              </Button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
