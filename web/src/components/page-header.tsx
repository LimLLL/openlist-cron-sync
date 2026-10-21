// 编辑式页头：编号与小标题、逐行遮罩升起的大标题；主操作进入固定顶栏，标题滚出视口后由顶栏接替显示。
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
  /** 小标题，如分区名。 */
  kicker: ReactNode;
  /** 标题第一行（无衬线）；详情页传实体名称。 */
  title: string;
  /** 标题第二行（衬线斜体），可省略。 */
  accent?: string;
  /** 右侧说明文字，桌面端与标题底部对齐。 */
  description?: ReactNode;
  /** 编号行最右侧的补充信息，如总数或返回链接。 */
  meta?: ReactNode;
  /** 页面主操作；桌面端进入固定顶栏，移动端显示在标题下方。 */
  actions?: ReactNode;
  /** hero 用于列表与概览；detail 用于实体详情，字号收一档。 */
  variant?: 'hero' | 'detail';
}

/** 渲染页头，并把紧凑标题与主操作同步到外壳顶栏。
 * @param props 页头配置。
 * @returns 页头元素（以及顶栏中的操作门户）。
 * @throws 不适用。
 */
export function PageHeader({
  index,
  kicker,
  title,
  accent,
  description,
  meta,
  actions,
  variant = 'hero',
}: PageHeaderProps) {
  const shell = useShell();
  const heading = useRef<HTMLHeadingElement>(null);
  // 中文标题以汉字或全角标点结尾时直接相接，拉丁文字之间才补空格。
  const compact = accent
    ? `${title}${/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]$/u.test(title) ? '' : ' '}${accent}`
    : title;
  const setCompactTitle = shell?.setCompactTitle;

  useEffect(() => {
    const element = heading.current;
    if (!element || !setCompactTitle) return;
    // 标题完全滑到顶栏下方后才切换，避免与顶栏内容同时出现。
    const observer = new IntersectionObserver(
      ([entry]) => setCompactTitle(entry.isIntersecting ? null : compact),
      { rootMargin: '-64px 0px 0px 0px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      setCompactTitle(null);
    };
  }, [compact, setCompactTitle]);

  return (
    <header className="page-header">
      <motion.div
        className="page-header-meta"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <span className="page-header-index">{index}</span>
        <span className="eyebrow">{kicker}</span>
        {meta && <span className="order-last eyebrow">{meta}</span>}
      </motion.div>
      <div className="page-header-body">
        <h1
          ref={heading}
          className={cn('page-title', variant === 'detail' && 'page-title-detail')}
        >
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
          {accent && (
            <span className="reveal-line">
              <motion.span
                className="block page-title-accent"
                initial={{ y: '105%' }}
                animate={{ y: 0 }}
                transition={{ duration: 0.9, ease: EASE, delay: 0.08 }}
              >
                {accent}
              </motion.span>
            </span>
          )}
        </h1>
        {description && (
          <motion.div
            className="mt-6 max-w-md text-sm leading-7 text-muted-foreground lg:mt-0"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE, delay: 0.2 }}
          >
            {description}
          </motion.div>
        )}
      </div>
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
