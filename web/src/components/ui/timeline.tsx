// 生命周期时间线：竖向发丝线串起各阶段，已发生的节点点亮，未发生的保持暗色。
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { StatusDot } from './status-dot';
import type { StatusTone } from './status-dot';

/** 时间线节点。 */
export interface TimelineItem {
  /** 阶段名称。 */
  label: ReactNode;
  /** 已格式化的时间；未发生时为 null。 */
  time: string | null;
  /** 节点色调；默认已发生为 success，未发生为 muted。 */
  tone?: StatusTone;
  /** 补充说明。 */
  note?: ReactNode;
}

/** 渲染时间线。
 * @param props items 按时间顺序的节点；className 附加样式。
 * @returns 有序列表。
 * @throws 不适用。
 */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn('relative space-y-5 pl-6', className)}>
      <span aria-hidden="true" className="absolute top-1.5 bottom-1.5 left-[3px] w-px bg-hairline" />
      {items.map((item, position) => {
        const happened = item.time !== null;
        return (
          <li key={position} className="relative">
            <StatusDot
              tone={item.tone ?? (happened ? 'success' : 'muted')}
              className={cn('absolute top-1.5 -left-6', !happened && 'opacity-40 shadow-none')}
            />
            <p className={cn('text-sm', happened ? 'text-foreground' : 'text-muted-foreground')}>
              {item.label}
            </p>
            <p className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
              {item.time ?? '—'}
            </p>
            {item.note && <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>}
          </li>
        );
      })}
    </ol>
  );
}
