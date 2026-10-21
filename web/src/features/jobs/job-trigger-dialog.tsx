// 运行触发对话框：真实运行与预览运行两张可选卡片，另可确认删除；成功后进入运行详情。
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Eye, LoaderCircle, Play, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/states';
import { useTriggerRun } from './job-queries';
import { SwitchRow } from './job-ui';

/** 触发对话框属性。 */
interface JobTriggerDialogProps {
  /** Job UUID。 */
  jobId: string;
  /** Job 名称。 */
  jobName: string;
  /** 是否打开。 */
  open: boolean;
  /** 关闭回调。 */
  onOpenChange: (open: boolean) => void;
}

/** 渲染一张运行类型卡片（单选项）。
 * @param props selected 是否选中；icon 图标；title/hint 文案；onSelect 选择回调。
 * @returns radio 按钮。
 * @throws 不适用。
 */
function ModeCard({
  selected,
  icon: Icon,
  title,
  hint,
  onSelect,
}: {
  selected: boolean;
  icon: LucideIcon;
  title: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'relative flex h-full flex-col items-start gap-4 rounded-2xl border p-5 text-left transition-[border-color,background-color,box-shadow] duration-300',
        selected
          ? 'border-accent/45 bg-accent/[0.06] shadow-[0_0_40px_-18px_rgb(185_237_188/0.6)]'
          : 'border-hairline bg-white/[0.015] hover:border-white/15',
      )}
    >
      <span
        className={cn(
          'grid size-10 place-items-center rounded-full border',
          selected ? 'border-accent/40 bg-accent/10 text-accent' : 'border-hairline text-muted-foreground',
        )}
      >
        <Icon size={17} aria-hidden="true" />
      </span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">{hint}</span>
      </span>
      {selected && (
        <span className="absolute top-4 right-4 grid size-5 place-items-center rounded-full bg-accent text-accent-foreground">
          <Check size={12} strokeWidth={3} aria-hidden="true" />
        </span>
      )}
    </button>
  );
}

/** 渲染任务运行触发对话框。
 * @param props 对话框配置。
 * @returns 触发对话框。
 * @throws 不适用。
 */
export function JobTriggerDialog({ jobId, jobName, open, onOpenChange }: JobTriggerDialogProps) {
  const { t } = useTranslation(['jobs', 'common']);
  const [dryRun, setDryRun] = useState(false);
  const [confirmDeletes, setConfirmDeletes] = useState(false);
  const trigger = useTriggerRun(jobId);
  const navigate = useNavigate();

  /** 触发运行，成功后导航至运行详情；进行中不重复提交（无幂等键）。
   * @returns 不适用。
   * @throws 不适用。
   */
  function handleTrigger() {
    if (trigger.isPending) return;
    trigger.mutate(
      { dryRun, confirmDeletes },
      {
        onSuccess: (result) => {
          onOpenChange(false);
          void navigate(`/runs/${result.id}`);
        },
      },
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!trigger.isPending) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content max-w-lg">
          <p className="eyebrow">{t('detail.kicker')}</p>
          <Dialog.Title className="mt-3 font-display text-2xl font-medium tracking-tight">
            {t('trigger.title')}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
            <Trans
              t={t}
              i18nKey="trigger.description"
              values={{ name: jobName }}
              components={{ highlight: <span className="text-foreground" /> }}
            />
          </Dialog.Description>

          <div role="radiogroup" aria-label={t('trigger.modeLabel')} className="mt-6 grid gap-3 sm:grid-cols-2">
            <ModeCard
              selected={!dryRun}
              icon={Play}
              title={t('trigger.realTitle')}
              hint={t('trigger.realHint')}
              onSelect={() => setDryRun(false)}
            />
            <ModeCard
              selected={dryRun}
              icon={Eye}
              title={t('trigger.previewOnly')}
              hint={t('trigger.previewHint')}
              onSelect={() => setDryRun(true)}
            />
          </div>

          <SwitchRow
            className="mt-3"
            label={t('trigger.confirmDeletes')}
            hint={t('trigger.confirmDeletesHint')}
            checked={confirmDeletes}
            onChange={setConfirmDeletes}
          />

          {trigger.isError && (
            <div className="mt-5">
              <ErrorState error={trigger.error} />
              {trigger.error instanceof ApiError &&
                (trigger.error.code === 'NETWORK_ERROR' || trigger.error.code === 'INVALID_RESPONSE') && (
                  <p className="mt-2 text-sm">
                    <Trans
                      t={t}
                      i18nKey="trigger.ambiguous"
                      components={{
                        runs: <Link to={`/runs?jobId=${jobId}`} className="text-accent underline" />,
                      }}
                    />
                  </p>
                )}
            </div>
          )}

          <div className="mt-7 flex justify-end gap-3">
            <Dialog.Close asChild>
              <Button variant="ghost" disabled={trigger.isPending}>
                {t('common:actions.cancel')}
              </Button>
            </Dialog.Close>
            <Button onClick={handleTrigger} disabled={trigger.isPending}>
              {trigger.isPending ? (
                <>
                  {t('trigger.triggering')}
                  <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" />
                </>
              ) : (
                <>
                  {dryRun ? t('trigger.preview') : t('trigger.execute')}
                  {dryRun ? <Eye size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                </>
              )}
            </Button>
          </div>

          <Dialog.Close asChild>
            <button
              className="absolute top-4 right-4 rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              aria-label={t('common:actions.close')}
              disabled={trigger.isPending}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
