// 右下角提示条（Radix Toast）：操作完成后的简短反馈，可带一个跳转链接；通过模块级 toast() 触发。
import * as ToastPrimitive from '@radix-ui/react-toast';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

/** 提示条内容。 */
export interface ToastInput {
  /** 标题。 */
  title: string;
  /** 补充说明。 */
  description?: string;
  /** 成功或失败；默认 success。 */
  tone?: 'success' | 'danger';
  /** 可选跳转，例如“查看运行”。 */
  action?: { label: string; to: string };
}

/** 队列中的提示条。 */
interface ToastItem extends ToastInput {
  /** 唯一键。 */
  id: number;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

/** 通知订阅者队列已变化。
 * @returns 不适用。
 * @throws 不适用。
 */
function emit(): void {
  listeners.forEach((listener) => listener());
}

/** 显示一条提示；最多保留 3 条，旧的先出队。
 * @param input 标题、说明、色调与跳转。
 * @returns 不适用。
 * @throws 不适用。
 */
export function toast(input: ToastInput): void {
  items = [...items, { ...input, id: nextId++ }].slice(-3);
  emit();
}

/** 移除一条提示。
 * @param id 提示键。
 * @returns 不适用。
 * @throws 不适用。
 */
function dismiss(id: number): void {
  items = items.filter((item) => item.id !== id);
  emit();
}

/** 订阅队列变化。
 * @param listener 回调。
 * @returns 取消订阅函数。
 * @throws 不适用。
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 渲染提示条容器；需放在 Router 内，以便跳转链接使用客户端路由。
 * @returns 提示条视口。
 * @throws 不适用。
 */
export function Toaster() {
  const { t } = useTranslation('common');
  const queue = useSyncExternalStore(
    subscribe,
    () => items,
    () => items,
  );
  return (
    <ToastPrimitive.Provider duration={6000} label={t('toast.label')}>
      {queue.map((item) => {
        const Icon = item.tone === 'danger' ? CircleAlert : CircleCheck;
        return (
          <ToastPrimitive.Root
            key={item.id}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
            className="flex w-full items-start gap-3 rounded-lg border border-border bg-surface p-3 shadow-lg motion-safe:animate-slide-in-right"
          >
            <Icon
              size={16}
              aria-hidden="true"
              className={cn(
                'mt-0.5 shrink-0',
                item.tone === 'danger' ? 'text-danger' : 'text-success',
              )}
            />
            <div className="min-w-0 flex-1">
              <ToastPrimitive.Title className="text-[13px] font-medium">
                {item.title}
              </ToastPrimitive.Title>
              {item.description && (
                <ToastPrimitive.Description className="mt-0.5 text-xs break-words text-muted-foreground">
                  {item.description}
                </ToastPrimitive.Description>
              )}
              {item.action && (
                <ToastPrimitive.Action altText={item.action.label} asChild>
                  <Link
                    to={item.action.to}
                    className="mt-1.5 inline-block text-xs font-medium text-link hover:underline"
                  >
                    {item.action.label}
                  </Link>
                </ToastPrimitive.Action>
              )}
            </div>
            <ToastPrimitive.Close
              aria-label={t('actions.close')}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X size={14} aria-hidden="true" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  );
}
