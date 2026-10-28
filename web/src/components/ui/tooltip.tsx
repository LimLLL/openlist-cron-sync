// 悬停提示（Radix Tooltip）：只用于补充信息，例如完整路径、错误详情或禁用原因。
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export const TooltipProvider = TooltipPrimitive.Provider;

/** 提示属性。 */
interface TipProps {
  /** 提示内容；为空时直接渲染子元素。 */
  content: ReactNode;
  /** 触发元素；必须能接收 ref 与事件（原生元素或转发 ref 的组件）。 */
  children: ReactNode;
  /** 弹出方向。 */
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/** 给子元素包一层悬停/聚焦提示。
 * @param props 提示内容与触发元素。
 * @returns 带提示的元素。
 * @throws 不适用。
 */
export function Tip({ content, children, side = 'top' }: TipProps) {
  if (content === null || content === undefined || content === '')
    return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-w-sm rounded-md bg-primary px-2 py-1 text-xs leading-relaxed break-words text-primary-foreground shadow-md motion-safe:animate-fade-in"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
