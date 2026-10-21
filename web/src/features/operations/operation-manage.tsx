// 未知结果的处置：醒目的后果说明，以及解除隔离、放弃责任两个分开的编辑式分节表单。
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { ShieldAlert, ShieldOff, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { EditorialSection } from '../../components/ui/editorial-section';
import { ErrorState } from '../../components/states';
import { cn } from '../../lib/utils';
import { useQuarantineRelease, useResolveOperation } from './operation-queries';
import type { OperationView } from './operation-contract';

/** 原因表单的共享属性。 */
interface ReasonFormProps {
  /** 后果说明，放在输入框上方的提示框中。 */
  consequence: string;
  /** 输入框占位文字。 */
  placeholder: string;
  /** 提交按钮文字。 */
  submitLabel: string;
  /** 提交中的按钮文字。 */
  submittingLabel: string;
  /** warning 用于解除隔离，danger 用于放弃。 */
  tone: 'warning' | 'danger';
  /** 是否正在提交。 */
  pending: boolean;
  /** 提交失败的错误。 */
  error: Error | null;
  /** 校验通过后提交已裁剪的原因。 */
  onSubmit: (reason: string) => void;
}

/** 渲染带后果提示的原因表单；缺少原因时的提示随语言切换。
 * @param props 表单配置。
 * @returns 表单元素。
 * @throws 不适用。
 */
function ReasonForm({
  consequence,
  placeholder,
  submitLabel,
  submittingLabel,
  tone,
  pending,
  error,
  onSubmit,
}: ReasonFormProps) {
  const { t } = useTranslation('operations');
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const hintId = useId();
  const Icon = tone === 'danger' ? ShieldOff : TriangleAlert;

  /** 校验非空后提交。
   * @param event 表单事件。
   * @returns 不适用。
   * @throws 不适用。
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!reason.trim()) {
      setReasonMissing(true);
      return;
    }
    setReasonMissing(false);
    if (pending) return;
    onSubmit(reason.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div
        className={cn(
          'flex gap-3 rounded-2xl border p-4 text-sm leading-7',
          tone === 'danger'
            ? 'border-danger/25 bg-danger/[0.05] text-foreground'
            : 'border-signal/25 bg-signal/[0.05] text-foreground',
        )}
      >
        <Icon
          size={18}
          className={cn('mt-1 shrink-0', tone === 'danger' ? 'text-danger' : 'text-signal')}
          aria-hidden="true"
        />
        <p>{consequence}</p>
      </div>
      <textarea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={placeholder}
        aria-label={t('manage.reasonLabel')}
        aria-describedby={hintId}
        aria-invalid={reasonMissing || undefined}
        className="field-input min-h-28 resize-y"
        required
        maxLength={1000}
      />
      <p id={hintId} className="text-[11.5px] text-muted-foreground">
        {t('manage.reasonHint')}
      </p>
      {reasonMissing && <p className="text-xs text-danger">{t('manage.reasonRequired')}</p>}
      {error && <ErrorState error={error} />}
      <Button type="submit" variant={tone === 'danger' ? 'danger' : 'secondary'} disabled={pending}>
        {pending ? submittingLabel : submitLabel}
      </Button>
    </form>
  );
}

/** 渲染解除隔离分节。
 * @param props op 操作；index 分节编号。
 * @returns 分节。
 * @throws 不适用。
 */
function ReleaseSection({ op, index }: { op: OperationView; index: string }) {
  const { t } = useTranslation('operations');
  const release = useQuarantineRelease();
  return (
    <EditorialSection index={index} title={t('manage.release.title')}>
      <ReasonForm
        consequence={t('manage.release.description')}
        placeholder={t('manage.release.placeholder')}
        submitLabel={t('manage.release.submit')}
        submittingLabel={t('manage.release.submitting')}
        tone="warning"
        pending={release.isPending}
        error={release.error}
        onSubmit={(reason) => release.mutate({ id: op.id, reason })}
      />
    </EditorialSection>
  );
}

/** 渲染放弃责任分节。
 * @param props op 操作；index 分节编号。
 * @returns 分节。
 * @throws 不适用。
 */
function AbandonSection({ op, index }: { op: OperationView; index: string }) {
  const { t } = useTranslation('operations');
  const resolve = useResolveOperation();
  return (
    <EditorialSection index={index} title={t('manage.abandon.title')}>
      <ReasonForm
        consequence={t('manage.abandon.description')}
        placeholder={t('manage.abandon.placeholder')}
        submitLabel={t('manage.abandon.submit')}
        submittingLabel={t('manage.abandon.submitting')}
        tone="danger"
        pending={resolve.isPending}
        error={resolve.error}
        onSubmit={(reason) => resolve.mutate({ id: op.id, reason })}
      />
    </EditorialSection>
  );
}

/** 渲染未知结果的处置区：仍在隔离时可解除，尚未处置时可放弃。
 * @param props op 操作；firstIndex 第一个分节的编号（从 1 开始）。
 * @returns 处置区域。
 * @throws 不适用。
 */
export function UnknownManagement({ op, firstIndex }: { op: OperationView; firstIndex: number }) {
  const { t } = useTranslation('operations');
  const isQuarantined = !op.quarantineReleasedAt && !op.resolution;
  const canAbandon = !op.resolution;
  const label = (offset: number) => String(firstIndex + offset).padStart(2, '0');
  return (
    <>
      <div className="mt-6 mb-2 flex gap-4 rounded-[1.5rem] border border-danger/20 bg-gradient-to-br from-danger/[0.07] to-transparent p-6">
        <ShieldAlert size={22} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        <div>
          <h2 className="font-display text-xl font-medium tracking-tight">{t('manage.title')}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">{t('manage.description')}</p>
        </div>
      </div>
      {isQuarantined && <ReleaseSection op={op} index={label(0)} />}
      {canAbandon && <AbandonSection op={op} index={label(isQuarantined ? 1 : 0)} />}
    </>
  );
}
