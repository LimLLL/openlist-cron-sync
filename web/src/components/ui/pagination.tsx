// 列表底部分页：显示当前范围与总数，多页时提供首/上/下/末页按钮。
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Button } from './button';

/** 分页属性。 */
interface PaginationProps {
  /** 当前页，从 1 开始。 */
  page: number;
  /** 每页条数。 */
  pageSize: number;
  /** 总条数。 */
  total: number;
  /** 翻页回调。 */
  onPageChange: (page: number) => void;
  /** 额外类名。 */
  className?: string;
}

/** 渲染分页条；总数为 0 时不渲染。
 * @param props 当前页、页大小、总数与回调。
 * @returns 分页元素或 null。
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
  if (total === 0 && page === 1) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const outside = start > total;
  const buttons = [
    { label: t('pagination.first'), icon: ChevronsLeft, to: 1, off: page <= 1 },
    {
      label: t('pagination.previous'),
      icon: ChevronLeft,
      to: Math.min(page - 1, pages),
      off: page <= 1,
    },
    {
      label: t('pagination.next'),
      icon: ChevronRight,
      to: page + 1,
      off: page >= pages,
    },
    {
      label: t('pagination.last'),
      icon: ChevronsRight,
      to: pages,
      off: page >= pages,
    },
  ];
  return (
    <nav
      aria-label={t('pagination.label')}
      className={cn(
        'flex items-center justify-between gap-3 text-xs text-muted-foreground',
        className,
      )}
    >
      <span className="tabular-nums">
        {outside
          ? t('pagination.outside', { total })
          : t('pagination.range', { start, end, total })}
      </span>
      {(pages > 1 || outside) && (
        <div className="flex items-center gap-1">
          {buttons.map(({ label, icon: Icon, to, off }) => (
            <Button
              key={label}
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              title={label}
              disabled={off && !(outside && to < page)}
              onClick={() => onPageChange(Math.max(1, to))}
            >
              <Icon size={15} aria-hidden="true" />
            </Button>
          ))}
        </div>
      )}
    </nav>
  );
}
