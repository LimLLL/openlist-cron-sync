// 编辑式分节：左列是编号与标题（桌面端吸顶），右列是内容，分节之间以发丝线分隔。
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** 渲染编辑式分节。
 * @param props index 编号；title 标题；description 补充说明；aside 标题下方的附加操作；children 内容。
 * @returns section 元素。
 * @throws 不适用。
 */
export function EditorialSection({
  index,
  title,
  description,
  aside,
  children,
  className,
  id,
}: {
  index: string;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn('editorial-section', className)}>
      <div className="editorial-section-label">
        <p className="page-header-index">{index}</p>
        <h2 className="mt-3 font-display text-xl font-medium tracking-tight">
          {title}
        </h2>
        {description && (
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
            {description}
          </p>
        )}
        {aside && <div className="mt-4">{aside}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
