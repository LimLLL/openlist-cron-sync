// 分段选择器：少量互斥选项的胶囊单选组，选中背景以弹簧在选项之间滑动；适合筛选条件。
import { useId } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

/** 单个选项。
 * @template T 选项值类型。
 */
export interface SegmentedOption<T extends string> {
  /** 选项值。 */
  value: T;
  /** 显示内容。 */
  label: ReactNode;
}

/** 渲染分段选择器。
 * @template T 选项值类型。
 * @param props label 无障碍名称；options 选项；value 当前值；onChange 选择回调。
 * @returns radiogroup 元素。
 * @throws 不适用。
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  // 每个实例独立的 layoutId，页面上多个选择器互不干扰。
  const group = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-hairline bg-white/[0.02] p-1',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative isolate rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
              selected ? 'text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {selected && (
              <motion.span
                layoutId={`segmented-${group}`}
                className="absolute inset-0 -z-10 rounded-full bg-accent"
                transition={{ type: 'spring', stiffness: 460, damping: 36 }}
              />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
