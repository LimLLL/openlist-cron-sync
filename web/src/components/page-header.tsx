// 编辑式页头：编号行定位页面，详情页在其下以遮罩升起实体名；主操作进入固定顶栏，实体名滚出视口后由顶栏接替显示。
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useShell } from '../app/shell-context';
import { cn } from '../lib/utils';

const EASE = [0.16, 1, 0.3, 1] as const;

/** 页头属性。 */
interface PageHeaderProps {
  /** 两位编号，如 "03"，与侧栏编号对应。 */
  index: string;
  /** 小标题，如分区名；未传 title 时它就是页面的 h1。 */
  kicker: ReactNode;
  /** 实体名称，仅详情与编辑页传入；列表、表单等页面省略。 */
  title?: string;
  /** 说明文字或实体属性，位于标题（或编号行）下方。 */
  description?: ReactNode;
  /** 编号行最右侧的补充信息，如总数或返回链接。 */
  meta?: ReactNode;
  /** 页面主操作；桌面端进入固定顶栏，移动端显示在页头内。 */
  actions?: ReactNode;
}

/** 渲染页头，并把实体名与主操作同步到外壳顶栏。
 * @param props 页头配置。
 * @returns 页头元素（以及顶栏中的操作门户）。
 * @throws 不适用。
 */
export function PageHeader({ index, kicker, title, description, meta, actions }: PageHeaderProps) {
  const shell = useShell();
  const heading = useRef<HTMLHeadingElement>(null);
  const setCompactTitle = shell?.setCompactTitle;

  useEffect(() => {
    const element = heading.current;
    if (!title || !element || !setCompactTitle) return;
    // 实体名完全滑到顶栏下方后才切换，避免与顶栏内容同时出现。
    const observer = new IntersectionObserver(
      ([entry]) => setCompactTitle(entry.isIntersecting ? null : title),
      { rootMargin: '-64px 0px 0px 0px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      setCompactTitle(null);
    };
  }, [title, setCompactTitle]);

  // 没有实体名的页面由编号行的小标题承担 h1，保证每页恰好一个一级标题。
  const Kicker = title ? 'span' : 'h1';

  return (
    <header className="page-header">
      <motion.div
        className="page-header-meta"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <span className="page-header-index">{index}</span>
        <Kicker className="eyebrow">{kicker}</Kicker>
        {meta && <span className="order-last eyebrow">{meta}</span>}
      </motion.div>
      {(title || description) && (
        <div className="page-header-body">
          {title && (
            <h1 ref={heading} className="page-title">
              <span className="reveal-line">
                <motion.span
                  className="block"
                  initial={{ y: '105%' }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.9, ease: EASE }}
                >
                  {title}
                </motion.span>
              </span>
            </h1>
          )}
          {description && (
            <motion.div
              className="max-w-2xl text-sm leading-7 text-muted-foreground"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE, delay: title ? 0.15 : 0.05 }}
            >
              {description}
            </motion.div>
          )}
        </div>
      )}
      {actions && (
        // 移动端顶栏空间不足，操作留在页内；桌面端由门户放进顶栏。
        <div className={cn('flex flex-wrap items-center gap-2', shell?.actionsSlot && 'sm:hidden')}>
          {actions}
        </div>
      )}
      {actions &&
        shell?.actionsSlot &&
        createPortal(
          <div className="hidden items-center gap-2 sm:flex">{actions}</div>,
          shell.actionsSlot,
        )}
    </header>
  );
}
