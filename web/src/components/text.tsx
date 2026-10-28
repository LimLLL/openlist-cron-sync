// 常用数据文本：相对时间（悬停显示完整时间并定时刷新）、等宽路径、实例:路径端点与短 ID。
import { useSyncExternalStore } from 'react';
import { formatRelative, formatTimeFull } from '../lib/format';
import { cn } from '../lib/utils';

let tick = Date.now();
const listeners = new Set<() => void>();
let timer: number | null = null;

/** 订阅 30 秒一次的共享时钟；没有订阅者时停止计时。
 * @param listener 时钟变化回调。
 * @returns 取消订阅函数。
 * @throws 不适用。
 */
function subscribeClock(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    tick = Date.now();
    timer = window.setInterval(() => {
      tick = Date.now();
      listeners.forEach((current) => current());
    }, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

/** 读取共享时钟，让相对时间和已用时间随时间推进重新渲染。
 * @returns 最近一次时钟刻度（毫秒）。
 * @throws 不适用。
 */
export function useClock(): number {
  return useSyncExternalStore(
    subscribeClock,
    () => tick,
    () => tick,
  );
}

/** 渲染相对时间，例如“3 分钟前”；悬停显示带时区的完整时间。
 * @param props iso 时间；className 额外类名。
 * @returns time 元素；无时间时为占位符。
 * @throws 不适用。
 */
export function RelativeTime({
  iso,
  className,
}: {
  iso: string | null | undefined;
  className?: string;
}) {
  useClock();
  if (!iso) return <span className="text-muted-foreground">—</span>;
  return (
    <time dateTime={iso} title={formatTimeFull(iso)} className={className}>
      {formatRelative(iso)}
    </time>
  );
}

/** 渲染单行截断的等宽路径，悬停显示完整路径；不被浏览器自动翻译。
 * @param props path 路径；className 额外类名。
 * @returns 路径文本。
 * @throws 不适用。
 */
export function PathText({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  return (
    <span
      translate="no"
      title={path}
      className={cn(
        'block min-w-0 truncate font-mono text-[12.5px]',
        className,
      )}
    >
      {path}
    </span>
  );
}

/** 渲染“实例名 · 路径”形式的端点。
 * @param props instance 实例名；path 路径；className 额外类名。
 * @returns 端点文本。
 * @throws 不适用。
 */
export function Endpoint({
  instance,
  path,
  className,
}: {
  instance: string;
  path: string;
  className?: string;
}) {
  return (
    <span
      title={`${instance} · ${path}`}
      className={cn('flex min-w-0 items-baseline gap-1.5', className)}
    >
      <span className="shrink-0 text-[13px]">{instance}</span>
      <span
        translate="no"
        className="min-w-0 truncate font-mono text-[12.5px] text-muted-foreground"
      >
        {path}
      </span>
    </span>
  );
}

/** 渲染 UUID 前 8 位，悬停显示完整 ID。
 * @param props id 完整 ID；className 额外类名。
 * @returns 短 ID。
 * @throws 不适用。
 */
export function ShortId({ id, className }: { id: string; className?: string }) {
  return (
    <span
      translate="no"
      title={id}
      className={cn('font-mono text-xs text-muted-foreground', className)}
    >
      {id.slice(0, 8)}
    </span>
  );
}
