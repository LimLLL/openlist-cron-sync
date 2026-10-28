// 下拉菜单（Radix DropdownMenu）：行内“更多操作”、账户菜单等；危险项使用红色文字。
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;
export const MenuRadioGroup = MenuPrimitive.RadioGroup;

const ITEM =
  'relative flex h-8 cursor-default items-center gap-2 rounded px-2 text-[13px] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 [&_svg]:shrink-0 [&_svg]:text-muted-foreground';

/** 渲染菜单弹层。
 * @param props Radix Content 属性。
 * @returns 门户中的菜单内容。
 * @throws 不适用。
 */
export function MenuContent({
  className,
  align = 'end',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-44 rounded-md border border-border bg-surface p-1 shadow-lg motion-safe:animate-fade-in',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

/** 渲染菜单项。
 * @param props Radix Item 属性；danger 为破坏性操作。
 * @returns 菜单项。
 * @throws 不适用。
 */
export function MenuItem({
  className,
  danger = false,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { danger?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        ITEM,
        danger &&
          'text-danger data-[highlighted]:bg-danger/10 [&_svg]:text-danger',
        className,
      )}
      {...props}
    />
  );
}

/** 渲染单选菜单项（例如主题、语言），选中时显示对勾。
 * @param props Radix RadioItem 属性。
 * @returns 单选菜单项。
 * @throws 不适用。
 */
export function MenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem className={cn(ITEM, 'pl-7', className)} {...props}>
      <MenuPrimitive.ItemIndicator className="absolute left-2 inline-flex">
        <Check size={14} aria-hidden="true" />
      </MenuPrimitive.ItemIndicator>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

/** 渲染菜单分组标题。
 * @param props children 标题文字。
 * @returns 分组标题。
 * @throws 不适用。
 */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <MenuPrimitive.Label className="px-2 pt-1.5 pb-1 text-xs text-muted-foreground">
      {children}
    </MenuPrimitive.Label>
  );
}

/** 渲染菜单分隔线。
 * @returns 分隔线。
 * @throws 不适用。
 */
export function MenuSeparator() {
  return <MenuPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />;
}
