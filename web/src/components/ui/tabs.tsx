// 下划线式标签页（Radix Tabs）；当前标签由调用方放进 URL，刷新和分享后保持不变。
import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export const Tabs = TabsPrimitive.Root;

/** 渲染标签栏。
 * @param props Radix List 属性。
 * @returns 标签栏。
 * @throws 不适用。
 */
export function TabsList({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'flex items-center gap-5 overflow-x-auto border-b border-border',
        className,
      )}
      {...props}
    />
  );
}

/** 渲染单个标签，可附带计数。
 * @param props Radix Trigger 属性；count 显示在文字后，warn 时计数用警示色。
 * @returns 标签按钮。
 * @throws 不适用。
 */
export function TabsTrigger({
  className,
  children,
  count,
  warn = false,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger> & {
  count?: ReactNode;
  warn?: boolean;
}) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent text-[13px] whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-foreground data-[state=active]:font-medium data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && count !== null && (
        <span
          className={cn(
            'rounded bg-surface-2 px-1.5 text-xs leading-5 tabular-nums',
            warn && 'bg-danger/12 text-danger',
          )}
        >
          {count}
        </span>
      )}
    </TabsPrimitive.Trigger>
  );
}

/** 渲染标签内容；未激活时不挂载，避免隐藏标签继续请求或轮询。
 * @param props Radix Content 属性。
 * @returns 标签内容。
 * @throws 不适用。
 */
export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('pt-4 outline-none', className)}
      {...props}
    />
  );
}
