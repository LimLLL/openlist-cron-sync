// 页面骨架原语：页头（返回链接、标题、徽标、主操作）、带标题的分区卡片、关键信息条与键值网格。
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '../lib/utils';

/** 页头属性。 */
interface PageHeaderProps {
  /** 页面标题（每页唯一的 h1）。 */
  title: ReactNode;
  /** 标题右侧的状态徽标。 */
  badges?: ReactNode;
  /** 标题下方一行说明或摘要。 */
  description?: ReactNode;
  /** 返回上一级的链接。 */
  back?: { to: string; label: string };
  /** 右侧主操作按钮。 */
  actions?: ReactNode;
}

/** 渲染页头。
 * @param props 标题、徽标、说明、返回链接与操作。
 * @returns 页头元素。
 * @throws 不适用。
 */
export function PageHeader({
  title,
  badges,
  description,
  back,
  actions,
}: PageHeaderProps) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1">
        {back && (
          <Link
            to={back.to}
            className="mb-1 inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft size={14} aria-hidden="true" />
            {back.label}
          </Link>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">
            {title}
          </h1>
          {badges}
        </div>
        {description && (
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}

/** 分区卡片属性。 */
interface SectionProps {
  /** 分区标题。 */
  title?: ReactNode;
  /** 标题后的补充文字。 */
  description?: ReactNode;
  /** 标题栏右侧操作，例如“查看全部”。 */
  actions?: ReactNode;
  /** 内容不加内边距，用于直接放表格或列表。 */
  flush?: boolean;
  /** 额外类名。 */
  className?: string;
  /** 内容。 */
  children: ReactNode;
}

/** 渲染带标题栏的分区卡片。
 * @param props 标题、说明、操作与内容。
 * @returns section 元素。
 * @throws 不适用。
 */
export function Section({
  title,
  description,
  actions,
  flush = false,
  className,
  children,
}: SectionProps) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-lg border border-border bg-surface',
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-4 py-2">
          <div className="flex min-w-0 items-baseline gap-2">
            {title && (
              <h2 className="truncate text-[13px] font-semibold">{title}</h2>
            )}
            {description && (
              <span className="truncate text-xs text-muted-foreground">
                {description}
              </span>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </div>
      )}
      <div className={flush ? undefined : 'p-4'}>{children}</div>
    </section>
  );
}

/** 关键信息条中的一项。 */
export interface Fact {
  /** 标签。 */
  label: ReactNode;
  /** 值。 */
  value: ReactNode;
}

/** 渲染详情页头部下方的一行关键信息；窄屏自动换行。
 * @param props facts 信息项；className 额外类名。
 * @returns 描述列表。
 * @throws 不适用。
 */
export function FactStrip({
  facts,
  className,
}: {
  facts: Fact[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        'mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]',
        className,
      )}
    >
      {facts.map((fact, index) => (
        <div key={index} className="min-w-0 bg-surface px-3 py-2">
          <dt className="truncate text-xs text-muted-foreground">
            {fact.label}
          </dt>
          <dd className="mt-0.5 min-w-0 truncate text-[13px] font-medium tabular-nums">
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 渲染两列键值网格（标签左、值右），用于配置与记录详情。
 * @param props items 键值项；className 额外类名。
 * @returns 描述列表。
 * @throws 不适用。
 */
export function KeyValue({
  items,
  className,
}: {
  items: Fact[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        'grid grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)] gap-x-6 gap-y-2 text-[13px]',
        className,
      )}
    >
      {items.map((item, index) => (
        <div key={index} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 设置浏览器标签标题，格式为“部分 · 部分 · OpenList Sync”。
 * @param parts 由具体到概括的标题片段；空值会被忽略。
 * @returns 不适用。
 * @throws 不适用。
 */
export function useDocumentTitle(
  ...parts: Array<string | null | undefined>
): void {
  const title = [...parts.filter(Boolean), 'OpenList Sync'].join(' · ');
  useEffect(() => {
    document.title = title;
  }, [title]);
}
