// 原生输入控件的统一外观：单行输入、多行文本与原生下拉框；无效状态通过 aria-invalid 表达。
import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

// 移动端字号 16px，避免 iOS Safari 聚焦时自动放大页面。
const CONTROL =
  'w-full min-w-0 rounded-md border border-input bg-surface text-base text-foreground shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-danger/20 sm:text-sm';

/** 单行输入框。
 * @param props 原生 input 属性。
 * @returns 输入框。
 * @throws 不适用。
 */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(CONTROL, 'h-8 px-2.5', className)} {...props} />;
}

/** 多行文本框。
 * @param props 原生 textarea 属性。
 * @returns 文本框。
 * @throws 不适用。
 */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(CONTROL, 'min-h-20 px-2.5 py-1.5 font-mono', className)}
      {...props}
    />
  );
}

/** 原生下拉框；保留浏览器自带的键盘与读屏行为。
 * @param props 原生 select 属性与 option 子元素。
 * @returns 带下拉箭头的选择框。
 * @throws 不适用。
 */
export function NativeSelect({
  className,
  children,
  ...props
}: ComponentProps<'select'>) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <select
        className={cn(CONTROL, 'h-8 appearance-none pr-7 pl-2.5')}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
