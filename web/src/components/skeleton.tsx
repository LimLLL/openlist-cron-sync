// 按真实布局拼装的加载骨架：静态内容（表头、标签、分区标题）照常显示，只给接口数据占位；占位块延迟淡入，快速请求不闪烁。
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import type { Fact } from './page';
import { Section } from './page';
import { Table, TBody, TD, TR } from './ui/table';

/** 渲染单个占位块；尺寸与形状由调用方按真实内容给出。
 * @param props className 宽高、圆角与外边距。
 * @returns 读屏隐藏的占位块。
 * @throws 不适用。
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block animate-skeleton rounded bg-surface-2', className)}
    />
  );
}

/** 加载区域：标记 aria-busy，并用一条读屏文字代替逐个占位块。
 * @param props label 读屏文字；className 额外类名；children 骨架内容。
 * @returns 加载区域容器。
 * @throws 不适用。
 */
export function SkeletonRegion({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation('common');
  return (
    <div aria-busy="true" className={className}>
      <span role="status" className="sr-only">
        {label ?? t('states.loading')}
      </span>
      {children}
    </div>
  );
}

/** 表格单元格的内容形状。
 * - title：名称链接；text：短文字；path：实例与路径；time：相对时间；
 * - number：数字；id：短 ID；badge：状态徽标；status：徽标加时间；
 * - button：单个小按钮；actions：按钮加更多菜单。
 * 右对齐的列在 SkeletonColumn 中传入与真实单元格相同的 text-right。
 */
export type CellKind =
  | 'title'
  | 'text'
  | 'path'
  | 'time'
  | 'number'
  | 'id'
  | 'badge'
  | 'status'
  | 'button'
  | 'actions';

/** 骨架列：形状，或形状加与真实单元格一致的类名（宽度、对齐）。 */
export type SkeletonColumn = CellKind | { kind: CellKind; className?: string };

// 每种文字形状轮换几种宽度，避免整列等长显得机械。
const TEXT_WIDTHS: Partial<Record<CellKind, readonly string[]>> = {
  title: ['w-36', 'w-28', 'w-44', 'w-32'],
  text: ['w-20', 'w-14', 'w-24', 'w-16'],
  path: ['w-44', 'w-32', 'w-52', 'w-40'],
  time: ['w-16', 'w-20', 'w-14'],
  number: ['w-10', 'w-8', 'w-12'],
  id: ['w-16'],
};
const BADGE_WIDTHS = ['w-16', 'w-14', 'w-12'] as const;

/** 按形状渲染一个单元格的占位内容；均为行内元素，对齐方式跟随单元格类名（如 text-right）。
 * @param kind 单元格形状。
 * @param index 用于轮换宽度的序号。
 * @returns 占位内容。
 * @throws 不适用。
 */
function CellShape({ kind, index }: { kind: CellKind; index: number }) {
  const pick = (widths: readonly string[]) => widths[index % widths.length];
  const inline = 'inline-block align-middle';
  const badge = <Skeleton className={cn(inline, 'h-5', pick(BADGE_WIDTHS))} />;
  switch (kind) {
    case 'badge':
      return badge;
    case 'status':
      return (
        <span className="inline-flex items-center gap-2 align-middle">
          {badge}
          <Skeleton className="h-3 w-12" />
        </span>
      );
    case 'button':
      return <Skeleton className={cn(inline, 'h-7 w-16 rounded-md')} />;
    case 'actions':
      return (
        <span className="inline-flex items-center gap-1 align-middle">
          <Skeleton className="h-7 w-16 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
        </span>
      );
    default:
      return (
        <Skeleton
          className={cn(
            inline,
            kind === 'title' ? 'h-3.5' : 'h-3',
            pick(TEXT_WIDTHS[kind] ?? ['w-20']),
          )}
        />
      );
  }
}

/** 表格骨架属性。 */
interface TableSkeletonProps {
  /** 与加载完成后相同的真实表头（THead）。 */
  head: ReactNode;
  /** 每列的占位形状，顺序与表头一致。 */
  columns: readonly SkeletonColumn[];
  /** 占位行数。 */
  rows?: number;
  /** 读屏文字。 */
  label?: string;
  /** 去掉外框，用于已有边框的分区卡片内。 */
  bare?: boolean;
}

/** 渲染表格骨架：真实表头加按列定制的占位行，行高与真实行一致，加载完成时不跳动。
 * @param props 表头、列形状、行数、读屏文字与是否去框。
 * @returns 加载中的表格。
 * @throws 不适用。
 */
export function TableSkeleton({
  head,
  columns,
  rows = 6,
  label,
  bare = false,
}: TableSkeletonProps) {
  return (
    <SkeletonRegion label={label}>
      <Table bare={bare}>
        {head}
        <TBody aria-hidden="true">
          {Array.from({ length: rows }, (_, row) => (
            <TR key={row} className="hover:bg-transparent">
              {columns.map((column, index) => {
                const { kind, className } =
                  typeof column === 'string' ? { kind: column } : column;
                return (
                  <TD key={index} className={className}>
                    <CellShape kind={kind} index={row + index} />
                  </TD>
                );
              })}
            </TR>
          ))}
        </TBody>
      </Table>
    </SkeletonRegion>
  );
}

// 值与字段名占位轮换的宽度。
const VALUE_WIDTHS = ['w-20', 'w-28', 'w-16', 'w-24'] as const;

/** 为信息条（FactStrip）或键值网格（KeyValue）生成占位项：标签真实显示，值为占位块。
 * @param labels 各项标签。
 * @returns 可直接传给 FactStrip / KeyValue 的项。
 * @throws 不适用。
 */
export function skeletonFacts(labels: readonly ReactNode[]): Fact[] {
  return labels.map((label, index) => ({
    label,
    value: (
      <LineSkeleton className={VALUE_WIDTHS[index % VALUE_WIDTHS.length]} />
    ),
  }));
}

/** 页头标题位置的占位（与 text-lg 标题等高）。
 * @param props className 宽度。
 * @returns 占位块。
 * @throws 不适用。
 */
export function TitleSkeleton({ className = 'w-48' }: { className?: string }) {
  return <Skeleton className={cn('my-1 h-5', className)} />;
}

/** 一行 13px 文字的占位：文字行高 20px，14px 高的占位块上下各留 3px，与真实文字行等高。
 * @param props className 宽度。
 * @returns 占位块。
 * @throws 不适用。
 */
export function LineSkeleton({ className = 'w-64' }: { className?: string }) {
  return <Skeleton className={cn('my-[3px] h-3.5', className)} />;
}

/** 页头操作按钮的占位（与默认尺寸按钮等高）。
 * @param props className 宽度。
 * @returns 占位块。
 * @throws 不适用。
 */
export function ButtonSkeleton({ className = 'w-20' }: { className?: string }) {
  return <Skeleton className={cn('h-8 rounded-md', className)} />;
}

/** 表单分区骨架的描述。 */
export interface FormSectionSkeleton {
  /** 分区标题（真实文字）。 */
  title: ReactNode;
  /** 分区说明（真实文字）。 */
  description?: ReactNode;
  /** 字段数量。 */
  fields: number;
  /** 字段独占整行（真实表单该分区不分两列时）。 */
  wide?: boolean;
}

/** 渲染表单骨架：真实分区标题，字段为“标签 + 输入框”占位，两列网格与真实表单一致。
 * @param props sections 分区；label 读屏文字；className 与真实表单相同的宽度类名。
 * @returns 加载中的表单。
 * @throws 不适用。
 */
export function FormSkeleton({
  sections,
  label,
  className,
}: {
  sections: readonly FormSectionSkeleton[];
  label?: string;
  className?: string;
}) {
  return (
    <SkeletonRegion label={label} className={cn('space-y-4', className)}>
      {sections.map((section, sectionIndex) => (
        <Section
          key={sectionIndex}
          title={section.title}
          description={section.description}
        >
          <div
            className={cn(
              'grid gap-x-4 gap-y-3',
              !section.wide && 'sm:grid-cols-2',
            )}
          >
            {Array.from({ length: section.fields }, (_, index) => (
              <div key={index} className="space-y-1.5">
                <LineSkeleton
                  className={
                    VALUE_WIDTHS[(sectionIndex + index) % VALUE_WIDTHS.length]
                  }
                />
                <Skeleton className="h-8 w-full rounded-md" />
              </div>
            ))}
          </div>
        </Section>
      ))}
    </SkeletonRegion>
  );
}
