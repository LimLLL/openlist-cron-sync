// 状态徽标：语义色调 + 文字，可选圆点与“进行中”脉冲；颜色从不单独表达含义。
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** 徽标色调。info 用于进行中的状态。 */
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3/70 text-muted-foreground',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/14 text-warning',
  danger: 'bg-danger/12 text-danger',
  info: 'bg-info/12 text-info',
};

/** 徽标属性。 */
interface BadgeProps {
  /** 色调，默认 neutral。 */
  tone?: Tone;
  /** 是否在文字前显示圆点。 */
  dot?: boolean;
  /** 圆点是否脉冲，用于进行中的状态；遵循减少动态效果设置。 */
  pulse?: boolean;
  /** 悬停提示，例如完整错误信息。 */
  title?: string;
  /** 额外类名。 */
  className?: string;
  /** 徽标文字。 */
  children: ReactNode;
}

/** 渲染紧凑徽标。
 * @param props 色调、圆点与文字。
 * @returns 徽标元素。
 * @throws 不适用。
 */
export function Badge({
  tone = 'neutral',
  dot = false,
  pulse = false,
  title,
  className,
  children,
}: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 max-w-full shrink-0 items-center gap-1.5 rounded px-1.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 shrink-0 rounded-full bg-current',
            pulse && 'motion-safe:animate-pulse',
          )}
        />
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}
