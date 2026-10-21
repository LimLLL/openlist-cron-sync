// 规格表：发丝线网格中的“标签 + 值”，用于详情页的关键参数，扫读比卡片堆叠更快。
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** 规格项。 */
export interface SpecItem {
  /** 小标签。 */
  label: ReactNode;
  /** 值；缺失时由调用方传入占位符。 */
  value: ReactNode;
  /** 值使用等宽字体（路径、ID、数字）。 */
  mono?: boolean;
  /** 桌面端横跨两列。 */
  wide?: boolean;
}

/** 渲染规格表。
 * @param props items 规格项；columns 桌面端列数；className 附加样式。
 * @returns 网格元素。
 * @throws 不适用。
 */
export function SpecGrid({
  items,
  columns = 3,
  className,
}: {
  items: SpecItem[];
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        'spec-grid grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'lg:grid-cols-3',
        columns === 4 && 'lg:grid-cols-4',
        className,
      )}
    >
      {items.map((item, position) => (
        <div key={position} className={cn('spec-cell', item.wide && 'sm:col-span-2')}>
          <dt className="eyebrow">{item.label}</dt>
          <dd className={cn('spec-value', item.mono && 'font-mono text-[13px]')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
