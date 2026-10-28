// 表单字段外壳：标签、说明与错误文字，并把说明/错误通过 aria-describedby 关联到控件。
import { Slot } from '@radix-ui/react-slot';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** 字段属性。 */
interface FieldProps {
  /** 控件 id，同时用于生成说明与错误的 id。 */
  id: string;
  /** 字段标签。 */
  label: ReactNode;
  /** 标签右侧的补充，例如“可选”。 */
  aside?: ReactNode;
  /** 控件下方的说明文字。 */
  hint?: ReactNode;
  /** 错误文字；存在时控件标记为无效。 */
  error?: ReactNode;
  /** 额外类名。 */
  className?: string;
  /** 唯一控件元素；Field 会给它补上 id 与 aria 属性。 */
  children: ReactNode;
}

/** 渲染带标签的表单字段。
 * @param props 标签、说明、错误与控件。
 * @returns 字段元素。
 * @throws 不适用。
 */
export function Field({
  id,
  label,
  aside,
  hint,
  error,
  className,
  children,
}: FieldProps) {
  const described =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        {aside && (
          <span className="text-xs text-muted-foreground">{aside}</span>
        )}
      </div>
      <Slot
        id={id}
        aria-describedby={described}
        aria-invalid={error ? true : undefined}
      >
        {children}
      </Slot>
      {hint && (
        <p
          id={`${id}-hint`}
          className="text-xs leading-relaxed text-muted-foreground"
        >
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
