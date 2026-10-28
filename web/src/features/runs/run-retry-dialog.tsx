// 运行详情的“重试未成功项”按钮与确认框：说明将重新检查的数量与范围，可选允许超阈值删除；成功后用提示条链接到新运行。
import { useRef, useState } from 'react';
import type { SubmitEvent } from 'react';
import { Link } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { ErrorState } from '../../components/states';
import { Button } from '../../components/ui/button';
import { Dialog, DialogClose, DialogContent } from '../../components/ui/dialog';
import { SwitchField } from '../../components/ui/switch';
import { toast } from '../../components/ui/toast';
import { Tip } from '../../components/ui/tooltip';
import { ApiError } from '../../lib/api-client';
import { useRetryRun } from './run-queries';
import type { RetryReason, RunDetail } from './run-contract';

/** 不可重试时仍显示（禁用）按钮的原因：用户需要知道为什么现在不能重试；其余原因直接隐藏按钮。 */
const SHOWN_REASONS = [
  'JOB_BUSY',
  'SOURCE_ENDPOINT_CHANGED',
  'HISTORY_EXPIRED',
] as const satisfies readonly RetryReason[];

/** 判断原因是否需要以禁用按钮加提示的形式展示。
 * @param reason 不可重试原因。
 * @returns 是否展示禁用按钮。
 * @throws 不适用。
 */
function shownReason(
  reason: RetryReason | null,
): reason is (typeof SHOWN_REASONS)[number] {
  return SHOWN_REASONS.some((item) => item === reason);
}

/** 渲染重试按钮与确认框；可重试时可点，部分原因下禁用并提示，其余情况隐藏入口。
 * @param props run 运行详情；name 用于提示条的任务名。
 * @returns 按资格展示的按钮与保持挂载的确认框。
 * @throws 不适用；请求错误在确认框内显示。
 */
export function RetryRunButton({
  run,
  name,
}: {
  run: RunDetail;
  name: string;
}) {
  const { t } = useTranslation(['runs', 'common']);
  const retry = useRetryRun();
  const [open, setOpen] = useState(false);
  const [confirmDeletes, setConfirmDeletes] = useState(false);
  const submitButton = useRef<HTMLButtonElement>(null);
  const eligibility = run.retryEligibility;

  /** 提交重试；进行中不重复提交（接口没有幂等键）。
   * @param event 表单提交事件。
   * @returns 不适用。
   * @throws 不适用。
   */
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (retry.isPending || !eligibility.eligible) return;
    retry.mutate(
      { id: run.id, confirmDeletes },
      {
        onSuccess: (created) => {
          setOpen(false);
          toast({
            title: t('detail.retry.started', { name }),
            action: {
              label: t('common:runDialog.view'),
              to: `/runs/${created.id}`,
            },
          });
        },
      },
    );
  };

  const error = retry.error;
  // 网络中断或响应无法解析时重试可能已被接受，提示先核对再决定。
  const ambiguous =
    error instanceof ApiError &&
    (error.code === 'NETWORK_ERROR' || error.code === 'INVALID_RESPONSE');

  return (
    <>
      {eligibility.eligible ? (
        <Button
          onClick={() => {
            retry.reset();
            setConfirmDeletes(false);
            setOpen(true);
          }}
        >
          <RotateCcw size={14} aria-hidden="true" />
          {t('detail.retry.button')}
        </Button>
      ) : shownReason(eligibility.reason) ? (
        <Tip content={t(`detail.retry.reason.${eligibility.reason}`)}>
          {/* 禁用按钮不触发悬停事件，外包一层承载提示。 */}
          <span tabIndex={0}>
            <Button disabled>
              <RotateCcw size={14} aria-hidden="true" />
              {t('detail.retry.button')}
            </Button>
          </span>
        </Tip>
      ) : null}
      {/* 请求收尾会刷新资格；保持已打开的确认框，避免丢失错误及结果不明提示。 */}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!retry.isPending) setOpen(next);
        }}
      >
        <DialogContent
          size="sm"
          title={t('detail.retry.title')}
          closeDisabled={retry.isPending}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            submitButton.current?.focus();
          }}
        >
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2 text-sm">
              {eligibility.eligible ? (
                <p>
                  {t('detail.retry.summary', {
                    files: t('detail.retry.files', {
                      count: eligibility.candidateFiles,
                    }),
                    directories: t('detail.retry.directories', {
                      count: eligibility.candidateDirectories,
                    }),
                  })}
                </p>
              ) : (
                eligibility.reason && (
                  <p className="text-warning" role="status">
                    {t(`detail.retry.reason.${eligibility.reason}`)}
                  </p>
                )
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('detail.retry.how')}
              </p>
              {eligibility.excludedItems > 0 && (
                <p className="text-xs leading-relaxed text-warning">
                  {t('detail.retry.excluded', {
                    count: eligibility.excludedItems,
                  })}
                </p>
              )}
            </div>
            <SwitchField
              id="run-retry-confirm-deletes"
              label={t('common:runDialog.confirmDeletes')}
              hint={t('common:runDialog.confirmDeletesHint')}
              checked={confirmDeletes}
              onCheckedChange={setConfirmDeletes}
              disabled={retry.isPending || !eligibility.eligible}
            />
            {error && (
              <div className="space-y-2">
                <ErrorState error={error} compact />
                {ambiguous && (
                  <p className="text-xs text-muted-foreground">
                    <Trans
                      t={t}
                      i18nKey="common:runDialog.ambiguous"
                      components={[
                        <Link
                          key="runs"
                          to={`/runs?jobId=${run.jobId}`}
                          className="text-link hover:underline"
                          onClick={() => setOpen(false)}
                        />,
                      ]}
                    />
                  </p>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <DialogClose asChild>
                <Button disabled={retry.isPending}>
                  {t('common:actions.cancel')}
                </Button>
              </DialogClose>
              <Button
                type="submit"
                variant="primary"
                disabled={retry.isPending || !eligibility.eligible}
                ref={submitButton}
              >
                {retry.isPending
                  ? t('common:runDialog.submitting')
                  : t('detail.retry.submit')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
