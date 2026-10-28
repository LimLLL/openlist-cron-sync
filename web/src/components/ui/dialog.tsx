// 模态对话框与右侧面板（Radix Dialog）：统一遮罩、标题、关闭按钮与底部操作区，以及破坏性操作确认框。
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { ErrorState } from '../states';
import { Button } from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/** 保存程序化打开对话框的来源，关闭时恢复键盘焦点。
 * @returns Radix内容的打开/关闭焦点事件处理器。
 * @throws 不适用。
 */
function useDialogFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement)) return;
      // 菜单项随菜单关闭而卸载，应返回对应菜单按钮。
      const menu = focused.closest<HTMLElement>('[role="menu"]');
      opener.current = menu?.id
        ? (document.querySelector<HTMLElement>(
            `[aria-controls="${CSS.escape(menu.id)}"]`,
          ) ?? focused)
        : focused;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      const previous = opener.current;
      const target =
        previous?.isConnected && previous !== document.body
          ? previous instanceof HTMLButtonElement && previous.disabled
            ? previous.parentElement?.closest<HTMLElement>('[tabindex="0"]')
            : previous
          : null;
      (target ?? document.getElementById('main-content'))?.focus({
        preventScroll: true,
      });
    },
  };
}

/** 对话框内容属性。 */
interface DialogContentProps {
  /** 标题，同时作为对话框的可访问名称。 */
  title: ReactNode;
  /** 标题下方说明，作为可访问描述。 */
  description?: ReactNode;
  /** 主体内容。 */
  children?: ReactNode;
  /** 底部操作区，通常为取消与确认按钮。 */
  footer?: ReactNode;
  /** 宽度档位。 */
  size?: 'sm' | 'md' | 'lg';
  /** 进行中时禁止关闭按钮。 */
  closeDisabled?: boolean;
  /** 额外类名。 */
  className?: string;
  /** 可选初始焦点处理；仍保留关闭后的来源焦点恢复。 */
  onOpenAutoFocus?: ComponentProps<
    typeof DialogPrimitive.Content
  >['onOpenAutoFocus'];
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' } as const;

/** 渲染居中模态框内容（需放在 Dialog 内）。
 * @param props 标题、说明、内容与底部操作。
 * @returns 门户中的遮罩与内容。
 * @throws 不适用。
 */
export function DialogContent({
  title,
  description,
  children,
  footer,
  size = 'md',
  closeDisabled = false,
  className,
  onOpenAutoFocus,
}: DialogContentProps) {
  const { t } = useTranslation('common');
  const focus = useDialogFocus();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay motion-safe:animate-fade-in" />
      <DialogPrimitive.Content
        onOpenAutoFocus={(event) => {
          focus.onOpenAutoFocus();
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        className={cn(
          'fixed top-[10vh] left-1/2 z-50 flex max-h-[80vh] w-[calc(100vw-2rem)] -translate-x-1/2 flex-col rounded-lg border border-border bg-surface shadow-xl motion-safe:animate-pop-in',
          SIZES[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-sm font-semibold">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">
                {title}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('actions.close')}
              disabled={closeDisabled}
              className="-mt-1 -mr-1.5"
            >
              <X size={15} aria-hidden="true" />
            </Button>
          </DialogPrimitive.Close>
        </div>
        {children && (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {children}
          </div>
        )}
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2/50 px-4 py-3">
            {footer}
          </div>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** 右侧面板内容属性。 */
interface SheetContentProps {
  /** 标题。 */
  title: ReactNode;
  /** 标题下方说明。 */
  description?: ReactNode;
  /** 标题右侧的附加操作，例如“在新页面打开”。 */
  actions?: ReactNode;
  /** 主体内容。 */
  children: ReactNode;
}

/** 渲染从右侧滑出的面板内容（需放在 Dialog 内），用于查看单条记录详情。
 * @param props 标题、说明、操作与内容。
 * @returns 门户中的遮罩与面板。
 * @throws 不适用。
 */
export function SheetContent({
  title,
  description,
  actions,
  children,
}: SheetContentProps) {
  const { t } = useTranslation('common');
  const focus = useDialogFocus();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay motion-safe:animate-fade-in" />
      <DialogPrimitive.Content
        {...focus}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-surface shadow-xl motion-safe:animate-slide-in-right"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <DialogPrimitive.Title className="truncate text-sm font-semibold">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">
                {title}
              </DialogPrimitive.Description>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('actions.close')}
              >
                <X size={15} aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** 确认框属性。 */
interface ConfirmDialogProps {
  /** 是否打开。 */
  open: boolean;
  /** 打开状态变化；进行中时忽略关闭。 */
  onOpenChange: (open: boolean) => void;
  /** 标题。 */
  title: string;
  /** 说明后果的文字。 */
  description: ReactNode;
  /** 确认按钮文字，默认“确认”。 */
  confirmLabel?: string;
  /** 确认回调。 */
  onConfirm: () => void;
  /** 请求进行中：禁用按钮并阻止关闭。 */
  pending?: boolean;
  /** 请求失败时在框内显示。 */
  error?: Error | null;
}

/** 渲染破坏性操作的确认框。
 * @param props 打开状态、文案与回调。
 * @returns 确认框。
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent
        size="sm"
        title={title}
        description={description}
        closeDisabled={pending}
        footer={
          <>
            <DialogClose asChild>
              <Button disabled={pending}>{t('actions.cancel')}</Button>
            </DialogClose>
            <Button variant="danger" onClick={onConfirm} disabled={pending}>
              {pending
                ? t('actions.processing')
                : (confirmLabel ?? t('actions.confirm'))}
            </Button>
          </>
        }
      >
        {error ? <ErrorState error={error} /> : null}
      </DialogContent>
    </Dialog>
  );
}
