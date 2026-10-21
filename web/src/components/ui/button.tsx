// 提供支持原生按钮与链接组合的统一操作样式。
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-foreground hover:bg-accent/85',
        secondary:
          'border border-border bg-surface-raised text-foreground hover:bg-surface-hover',
        ghost:
          'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
);

/** 原生按钮属性以及共享视觉变体。 */
type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** 为 true 时将样式交给唯一子元素，例如路由链接。 */
    asChild?: boolean;
  };

/** 渲染可访问按钮，默认避免在表单中意外提交。
 * @param props 原生属性、变体与子元素。
 * @returns 按钮或带样式的子元素。
 * @throws 不适用。
 */
export function Button({
  className,
  variant,
  asChild = false,
  type,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      className={cn(buttonVariants({ variant }), className)}
      {...(!asChild ? { type: type ?? 'button' } : {})}
      {...props}
    />
  );
}
