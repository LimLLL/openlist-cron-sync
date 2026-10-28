// 紧凑数据表：约 40px 行高、等宽数字、表头与行悬停底色；可排序表头带 aria-sort。
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** 表格容器；窄屏时横向滚动而不是挤压列。
 * @param props 原生 table 属性；bare 为 true 时去掉外框，用于已有边框的分区卡片内。
 * @returns 表格。
 * @throws 不适用。
 */
export function Table({
  className,
  bare = false,
  ...props
}: ComponentProps<'table'> & { bare?: boolean }) {
  return (
    <div
      className={cn(
        'overflow-x-auto',
        !bare && 'rounded-lg border border-border bg-surface',
      )}
    >
      <table
        className={cn('w-full border-collapse text-sm tabular-nums', className)}
        {...props}
      />
    </div>
  );
}

/** 表头分组。
 * @param props 原生 thead 属性。
 * @returns thead。
 * @throws 不适用。
 */
export function THead({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      className={cn('bg-surface-2/60 text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

/** 表体分组。
 * @param props 原生 tbody 属性。
 * @returns tbody。
 * @throws 不适用。
 */
export function TBody(props: ComponentProps<'tbody'>) {
  return <tbody {...props} />;
}

/** 数据行；有悬停底色，最后一行无下边框。
 * @param props 原生 tr 属性。
 * @returns tr。
 * @throws 不适用。
 */
export function TR({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b border-border last:border-b-0 hover:bg-surface-2/50',
        className,
      )}
      {...props}
    />
  );
}

/** 表头单元格。
 * @param props 原生 th 属性。
 * @returns th。
 * @throws 不适用。
 */
export function TH({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn(
        'h-9 border-b border-border px-3 text-left font-medium whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}

/** 数据单元格。
 * @param props 原生 td 属性。
 * @returns td。
 * @throws 不适用。
 */
export function TD({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td className={cn('h-10 px-3 py-1.5 align-middle', className)} {...props} />
  );
}

/** 可排序表头属性。 */
interface SortHeaderProps {
  /** 列标题。 */
  children: ReactNode;
  /** 当前列的排序方向；未按此列排序时为 null。 */
  direction: 'asc' | 'desc' | null;
  /** 点击切换排序。 */
  onSort: () => void;
  /** 额外类名。 */
  className?: string;
}

/** 渲染可点击排序的表头单元格。
 * @param props 标题、方向与回调。
 * @returns 带 aria-sort 的 th。
 * @throws 不适用。
 */
export function SortHeader({
  children,
  direction,
  onSort,
  className,
}: SortHeaderProps) {
  const Icon =
    direction === 'asc'
      ? ArrowUp
      : direction === 'desc'
        ? ArrowDown
        : ChevronsUpDown;
  return (
    <TH
      className={className}
      aria-sort={
        direction === 'asc'
          ? 'ascending'
          : direction === 'desc'
            ? 'descending'
            : 'none'
      }
    >
      <button
        type="button"
        onClick={onSort}
        className="-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground"
      >
        {children}
        <Icon
          size={12}
          aria-hidden="true"
          className={direction ? 'text-foreground' : 'opacity-50'}
        />
      </button>
    </TH>
  );
}
