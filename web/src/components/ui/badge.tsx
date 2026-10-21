// 状态标签：发丝线胶囊内一枚发光圆点加文字，进行中的状态带呼吸光环；文字始终可见，颜色不是唯一信息。
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { StatusDot } from './status-dot';
import type { StatusTone } from './status-dot';

const badgeVariants = cva(
  'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none tracking-wide whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-hairline bg-white/[0.02] text-muted-foreground',
        success: 'border-accent/20 bg-accent/[0.06] text-accent',
        warning: 'border-signal/25 bg-signal/[0.07] text-signal',
        danger: 'border-danger/25 bg-danger/[0.07] text-danger',
        info: 'border-white/15 bg-white/[0.04] text-foreground',
        active: 'border-accent/25 bg-accent/[0.08] text-accent',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const DOT_TONES: Record<NonNullable<BadgeProps['variant']>, StatusTone> = {
  default: 'muted',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  active: 'active',
};

/** 状态标签属性。 */
type BadgeProps = VariantProps<typeof badgeVariants> & {
  /** 标签内容。 */
  children: ReactNode;
  /** 附加样式。 */
  className?: string;
  /** 显示呼吸光环（用于进行中的状态）。 */
  pulse?: boolean;
  /** 隐藏圆点，仅保留文字胶囊（用于非状态类标签）。 */
  plain?: boolean;
};

/** 渲染语义化状态标签。
 * @param props 变体、内容、呼吸光环与是否省略圆点。
 * @returns 状态标签。
 * @throws 不适用。
 */
export function Badge({ variant, children, className, pulse, plain }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)}>
      {!plain && <StatusDot tone={DOT_TONES[variant ?? 'default']} pulse={pulse} />}
      {children}
    </span>
  );
}
