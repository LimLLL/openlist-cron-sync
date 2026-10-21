// 提供共享加载、空内容和可恢复错误状态，避免以空列表掩盖请求失败。
import { CircleAlert, Orbit, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api-client';
import { useErrorText } from '../i18n/error-text';
import { Button } from './ui/button';

const SKELETON_WIDTHS = ['w-2/5', 'w-full', 'w-4/5', 'w-3/5'] as const;

/** 在内容原位展示骨架占位；全局进度由顶部进度条表达，这里不弹出任何加载框。
 * @param props label 仅供读屏软件；rows 为占位行数。
 * @returns 骨架占位区域。
 * @throws 不适用。
 */
export function LoadingState({
  label,
  rows = 3,
}: {
  label?: string;
  rows?: number;
}) {
  const { t } = useTranslation('common');
  return (
    <div role="status" className="skeleton-group space-y-3 py-1">
      <span className="sr-only">{label ?? t('states.loading')}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={`skeleton h-3.5 ${SKELETON_WIDTHS[index % SKELETON_WIDTHS.length]}`}
        />
      ))}
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
    <div className="relative overflow-hidden rounded-[1.75rem] border border-hairline px-8 py-16 text-center">
      {/* 背景同心轨道，空状态也保持观测站的视觉语言。 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
        <span className="absolute size-[22rem] rounded-full border border-accent/[0.07]" />
        <span className="absolute size-[14rem] rounded-full border border-accent/[0.1]" />
        <span className="absolute size-[7rem] rounded-full border border-accent/[0.14]" />
      </div>
      <div className="relative">
        <span className="mx-auto mb-6 grid size-12 place-items-center rounded-full border border-accent/25 bg-accent/[0.06] text-accent">
          <Orbit size={22} strokeWidth={1.4} aria-hidden="true" />
        </span>
        <h2 className="serif-accent text-3xl">{title}</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        {action && <div className="mt-8 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

/** 展示本地化的错误信息及明确的手动重试入口；已知错误码显示译文，原始信息保留在诊断行。
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
  const { t } = useTranslation('common');
  const errorText = useErrorText();
  const api = error instanceof ApiError ? error : null;
  const message = api ? errorText(api.code, api.message) : error.message;
  // 后端原文对排查有用；客户端错误（status 0）的原文是本地固定英文，不重复显示。
  const detail = api && api.status !== 0 && message !== api.message ? api.message : null;
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
            <p className="break-all font-mono text-[10px] text-muted-foreground">
              {api.code}
              {detail && ` · ${detail}`}
              {api.requestId && ` · ${t('states.requestId', { id: api.requestId })}`}
            </p>
          )}
        </div>
      </div>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          <RotateCcw size={15} aria-hidden="true" />
          {t('actions.retry')}
        </Button>
      )}
    </div>
  );
}
