// 确认对话框，用于归档等破坏性操作。
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './button';
import { ErrorState } from '../states';

/** 确认对话框属性。 */
interface ConfirmDialogProps {
  /** 是否打开。 */
  open: boolean;
  /** 关闭回调。 */
  onOpenChange: (open: boolean) => void;
  /** 对话框标题。 */
  title: string;
  /** 描述文本。 */
  description: ReactNode;
  /** 确认按钮文本。 */
  confirmLabel?: string;
  /** 确认回调。 */
  onConfirm: () => void;
  /** 是否正在执行。 */
  pending?: boolean;
  /** 操作失败时保持对话框并展示服务端原因。 */
  error?: Error | null;
}

/** 渲染带警告图标的确认对话框。
 * @param props 对话框配置。
 * @returns 确认对话框。
 * @throws 不适用。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending = false,
  error,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common');
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content max-w-md">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-danger/25 bg-danger/[0.08]">
              <AlertTriangle
                size={20}
                className="text-danger"
                aria-hidden="true"
              />
            </div>
            <div>
              <Dialog.Title className="text-base font-medium">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {description}
              </Dialog.Description>
            </div>
          </div>
          {error && <ErrorState error={error} />}
          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close asChild>
              <Button variant="ghost" disabled={pending}>
                {t('actions.cancel')}
              </Button>
            </Dialog.Close>
            <Button variant="danger" onClick={onConfirm} disabled={pending}>
              {pending
                ? t('actions.processing')
                : (confirmLabel ?? t('actions.confirm'))}
            </Button>
          </div>
          <Dialog.Close asChild>
            <button
              className="absolute right-3 top-3 rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              aria-label={t('actions.close')}
              disabled={pending}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
