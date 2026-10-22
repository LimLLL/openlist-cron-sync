// 胶囊按钮：主按钮薄荷色带柔光，次按钮发丝线描边，支持危险操作与紧凑尺寸，可组合原生按钮或链接。
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-[background-color,color,border-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-accent-foreground shadow-[0_0_0_1px_rgb(185_237_188/0.4),0_8px_30px_-10px_rgb(185_237_188/0.55)] hover:bg-[#cdf5cf] hover:shadow-[0_0_0_1px_rgb(185_237_188/0.6),0_10px_40px_-8px_rgb(185_237_188/0.7)]',
        secondary:
          'border border-hairline bg-white/[0.03] text-foreground hover:border-white/20 hover:bg-white/[0.06]',
        ghost:
          'text-muted-foreground hover:bg-white/[0.05] hover:text-foreground',
        danger:
          'border border-danger/30 bg-danger/[0.06] text-danger hover:border-danger/50 hover:bg-danger/[0.12]',
      },
      size: {
        default: 'min-h-11 px-5 text-sm',
        sm: 'min-h-9 px-4 text-[13px]',
        icon: 'size-10 text-sm',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

/** 原生按钮属性以及共享视觉变体。 */
type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** 为 true 时将样式交给唯一子元素，例如路由链接。 */
    asChild?: boolean;
  };

/** 渲染可访问按钮，默认避免在表单中意外提交。
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
