// 分段选择：一组互斥选项（筛选标签、模式切换），以 radiogroup 语义支持方向键切换。
import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** 单个分段选项。
 * @template T 选项值类型。
 */
export interface SegmentedOption<T extends string> {
  /** 选项值。 */
  value: T;
  /** 显示文字。 */
  label: ReactNode;
  /** 文字后的计数，例如筛选结果数量。 */
  count?: number;
  /** 是否不可选。 */
  disabled?: boolean;
}

/** 分段选择属性。
 * @template T 选项值类型。
 */
interface SegmentedProps<T extends string> {
  /** 读屏标签。 */
  label: string;
  /** 当前值。 */
  value: T;
  /** 选项列表。 */
  options: readonly SegmentedOption<T>[];
  /** 选择回调。 */
  onChange: (value: T) => void;
  /** 整体禁用。 */
  disabled?: boolean;
  /** 额外类名。 */
  className?: string;
}

/** 渲染分段选择。
 * @template T 选项值类型。
 * @param props 当前值、选项与回调。
 * @returns radiogroup 元素。
 * @throws 不适用。
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: SegmentedProps<T>) {
  const group = useRef<HTMLDivElement>(null);
  // 已选项可能因源实例变化而被禁用；仍需让键盘用户进入组内修正选择。
  const tabStop =
    options.find((option) => option.value === value && !option.disabled) ??
    options.find((option) => !option.disabled);

  /** 方向键在可用选项间移动并选中。
   * @param event 键盘事件。
   * @returns 不适用。
   * @throws 不适用。
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    )
      return;
    event.preventDefault();
    const enabled = options.filter((option) => !option.disabled);
    const focused =
      event.target instanceof HTMLButtonElement
        ? event.target.dataset.value
        : value;
    const index = enabled.findIndex((option) => option.value === focused);
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = enabled[(index + step + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    group.current
      ?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)
      ?.focus();
  };

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex h-8 max-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-border bg-surface-2 p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            data-value={option.value}
            aria-checked={checked}
            tabIndex={!disabled && option === tabStop ? 0 : -1}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-full shrink-0 items-center gap-1.5 rounded px-2.5 text-[13px] whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
              checked && 'bg-surface font-medium text-foreground shadow-xs',
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
