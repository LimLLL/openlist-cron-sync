// 提供共享加载、空内容和可恢复错误状态，避免以空列表掩盖请求失败。
import { CircleAlert, LoaderCircle, Orbit, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '../lib/api-client';
import { Button } from './ui/button';

/** 展示可被辅助技术感知的加载状态。
 * @param props 可选加载说明。
 * @returns 状态区域。
 * @throws 不适用。
 */
export function LoadingState({
  label = 'Loading your workspace…',
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 p-12 text-muted-foreground"
    >
      <LoaderCircle
        className="motion-safe:animate-spin"
        size={20}
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  );
}

/** 展示已确认的空内容与可选下一步操作。
 * @param props 标题、描述与操作元素。
 * @returns 空内容区域。
 * @throws 不适用。
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center">
      <Orbit
        className="mx-auto mb-4 text-accent"
        size={28}
        aria-hidden="true"
      />
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** 展示安全错误信息及明确的手动重试入口。
 * @param props 错误与可选重试回调。
 * @returns 可被读屏软件立即读取的错误区域。
 * @throws 不适用。
 */
export function ErrorState({
  error,
  onRetry,
}: {
  error: Error;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-danger/25 bg-danger/8 p-4 text-sm"
    >
      <div className="flex gap-3">
        <CircleAlert
          size={18}
          className="mt-0.5 shrink-0 text-danger"
          aria-hidden="true"
        />
        <div className="min-w-0 space-y-2">
          <p>{error.message}</p>
          {error instanceof ApiError && error.retryAfter !== null && (
            <p className="text-muted-foreground">
              Try again in {error.retryAfter} seconds.
            </p>
          )}
          {error instanceof ApiError &&
            error.details.map((detail) => (
              <p key={detail.field} className="text-muted-foreground">
                {detail.field}: {detail.reason}
              </p>
            ))}
          {error instanceof ApiError && error.requestId && (
            <p className="break-all font-mono text-[10px] text-muted-foreground">
              Request {error.requestId}
            </p>
          )}
        </div>
      </div>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          <RotateCcw size={15} aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  );
}
