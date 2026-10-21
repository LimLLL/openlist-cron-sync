// 分页控件，基于 URL search params 驱动，配合 usePageParams 使用。
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

/** 分页属性。 */
interface PaginationProps {
  /** 当前页号。 */
  page: number;
  /** 每页条数。 */
  pageSize: number;
  /** 总记录数。 */
  total: number;
  /** 翻页回调。 */
  onPageChange: (page: number) => void;
  /** 附加样式。 */
  className?: string;
}

/** 渲染分页导航，显示当前范围和翻页按钮。
 * @param props 分页状态和回调。
 * @returns 分页控件或 null（单页时隐藏）。
 * @throws 不适用。
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
}: PaginationProps) {
  const { t } = useTranslation('common');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1 && page <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 text-xs text-muted-foreground',
        className,
      )}
    >
      <span className="font-mono tabular-nums">
        {page > totalPages
          ? t('pagination.outside', { total })
          : t('pagination.range', { start, end, total })}
      </span>
      <div className="flex items-center gap-1">
        <PageButton
          onClick={() => onPageChange(1)}
          disabled={page <= 1}
          label={t('pagination.first')}
        >
          <ChevronsLeft size={15} />
        </PageButton>
        <PageButton
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          label={t('pagination.previous')}
        >
          <ChevronLeft size={15} />
        </PageButton>
        <span className="px-2 font-mono tabular-nums">
          {page} / {totalPages}
        </span>
        <PageButton
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          label={t('pagination.next')}
        >
          <ChevronRight size={15} />
        </PageButton>
        <PageButton
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages}
          label={t('pagination.last')}
        >
          <ChevronsRight size={15} />
        </PageButton>
      </div>
    </div>
  );
}

/** 渲染单个分页按钮。
 * @param props 按钮属性。
 * @returns 分页按钮。
 * @throws 不适用。
 */
function PageButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
