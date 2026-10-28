// 共享加载骨架、空内容与可恢复错误状态；请求失败从不以空列表掩盖。
import { CircleAlert, Inbox, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api-client';
import { useErrorText } from '../i18n/error-text';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

const WIDTHS = ['w-2/5', 'w-full', 'w-4/5', 'w-3/5'] as const;

/** 后台刷新失败时保留内容，并说明当前显示的是上次成功结果。
 * @param props show 是否发生有缓存数据的刷新错误。
 * @returns 非阻塞状态提示或null。
 * @throws 不适用。
 */
export function StaleNotice({ show }: { show: boolean }) {
  const { t } = useTranslation('common');
  return show ? (
    <p role="status" className="mb-3 text-xs text-warning">
      {t('states.stale')}
    </p>
  ) : null;
}

/** 渲染原位骨架行，只在首次加载且没有数据时使用。
 * @param props label 读屏文字；rows 骨架行数；className 额外类名。
 * @returns 带 status 角色的骨架。
 * @throws 不适用。
 */
export function LoadingState({
  label,
  rows = 3,
  className,
}: {
  label?: string;
  rows?: number;
  className?: string;
}) {
  const { t } = useTranslation('common');
  return (
    <div role="status" className={cn('space-y-3 py-1', className)}>
      <span className="sr-only">{label ?? t('states.loading')}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={cn(
            'h-3.5 rounded bg-surface-2 motion-safe:animate-pulse',
            WIDTHS[index % WIDTHS.length],
          )}
        />
      ))}
    </div>
  );
}

/** 渲染表格形状的骨架，尺寸与真实表格一致以避免布局跳动。
 * @param props rows 行数；columns 列数；label 读屏文字。
 * @returns 骨架表格。
 * @throws 不适用。
 */
export function TableSkeleton({
  rows = 6,
  columns = 5,
  label,
}: {
  rows?: number;
  columns?: number;
  label?: string;
}) {
  const { t } = useTranslation('common');
  return (
    <div
      role="status"
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <span className="sr-only">{label ?? t('states.loading')}</span>
      <div
        aria-hidden="true"
        className="h-9 border-b border-border bg-surface-2/60"
      />
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          aria-hidden="true"
          className="flex h-10 items-center gap-6 border-b border-border px-3 last:border-b-0"
        >
          {Array.from({ length: columns }, (_, column) => (
            <div
              key={column}
              className={cn(
                'h-3 rounded bg-surface-2 motion-safe:animate-pulse',
                column === 0 ? 'w-40' : 'w-20',
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 渲染空内容提示。
 * @param props title 标题；description 说明；action 下一步操作；compact 用于卡片内部。
 * @returns 空状态。
 * @throws 不适用。
 */
export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center',
        compact
          ? 'px-4 py-8'
          : 'rounded-lg border border-dashed border-input px-6 py-12',
      )}
    >
      <Inbox size={20} aria-hidden="true" className="text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">{title}</p>
      {description && (
        <p className="mt-1 max-w-md text-[13px] text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** 渲染错误：本地化错误码、后端原文、字段详情、重试等待与请求 ID，可选重试。
 * @param props error 错误；onRetry 重试回调；compact 用于表格行或卡片内。
 * @returns 带 alert 角色的错误块。
 * @throws 不适用。
 */
export function ErrorState({
  error,
  onRetry,
  compact = false,
}: {
  error: Error;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation('common');
  const errorText = useErrorText();
  const api = error instanceof ApiError ? error : null;
  const message = api ? errorText(api.code, api.message) : error.message;
  // 后端原文对排查有用；客户端错误（status 0）的原文是本地固定英文，不重复显示。
  const detail =
    api && api.status !== 0 && message !== api.message ? api.message : null;
  return (
    <div
      role="alert"
      className={cn(
        'flex gap-2.5 rounded-lg border border-danger/25 bg-danger/6 text-[13px]',
        compact ? 'p-2.5' : 'p-3',
      )}
    >
      <CircleAlert
        size={16}
        className="mt-0.5 shrink-0 text-danger"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p>{message}</p>
        {api && api.retryAfter !== null && (
          <p className="text-muted-foreground">
            {t('states.retryAfter', { count: api.retryAfter })}
          </p>
        )}
        {api?.details.map((field) => (
          <p key={field.field} className="text-muted-foreground">
            {field.field}: {field.reason}
          </p>
        ))}
        {api && (detail || api.requestId) && (
          <p className="font-mono text-[11px] break-all text-muted-foreground">
            {api.code}
            {detail && ` · ${detail}`}
            {api.requestId &&
              ` · ${t('states.requestId', { id: api.requestId })}`}
          </p>
        )}
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry} className="shrink-0">
          <RotateCcw size={13} aria-hidden="true" />
          {t('actions.retry')}
        </Button>
      )}
    </div>
  );
}
