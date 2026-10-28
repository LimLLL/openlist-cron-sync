// 开关：Radix Switch 的紧凑外观，以及“标签 + 说明 + 开关”一行式字段。
import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** 渲染开关控件。
 * @param props Radix Switch 属性。
 * @returns 开关。
 * @throws 不适用。
 */
export function Switch({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-surface-3 transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-surface shadow-sm transition-transform data-[state=checked]:translate-x-[1.125rem] dark:bg-foreground dark:data-[state=checked]:bg-primary-foreground" />
    </SwitchPrimitive.Root>
  );
}

/** 一行式开关字段属性。 */
interface SwitchFieldProps {
  /** 开关 id。 */
  id: string;
  /** 标签。 */
  label: ReactNode;
  /** 标签下方说明。 */
  hint?: ReactNode;
  /** 是否开启。 */
  checked: boolean;
  /** 切换回调。 */
  onCheckedChange: (checked: boolean) => void;
  /** 是否禁用。 */
  disabled?: boolean;
  /** 额外类名。 */
  className?: string;
}

/** 渲染左侧文字、右侧开关的字段。
 * @param props 标签、说明与受控状态。
 * @returns 开关字段。
 * @throws 不适用。
 */
export function SwitchField({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  className,
}: SwitchFieldProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        {hint && (
          <p
            id={`${id}-hint`}
            className="mt-0.5 text-xs leading-relaxed text-muted-foreground"
          >
            {hint}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5"
      />
    </div>
  );
}
