// 紧凑按钮：主、次、幽灵与危险四种变体，可通过 asChild 把样式交给链接等子元素。
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/85',
        secondary:
          'border border-input bg-surface text-foreground shadow-xs hover:bg-surface-2',
        ghost: 'text-foreground hover:bg-surface-2',
        danger: 'bg-danger text-danger-foreground hover:bg-danger/85',
      },
      size: {
        sm: 'h-7 px-2.5',
        md: 'h-8 px-3',
        icon: 'size-8',
        'icon-sm': 'size-7',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

/** 原生按钮属性以及共享视觉变体。 */
type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** 为 true 时将样式交给唯一子元素，例如路由链接。 */
    asChild?: boolean;
  };

/** 渲染按钮，默认 type="button"，避免在表单中意外提交。
 * @param props 原生属性、变体、尺寸与子元素。
 * @returns 按钮或带样式的子元素。
 * @throws 不适用。
 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...(!asChild ? { type: type ?? 'button' } : {})}
      {...props}
    />
  );
}
