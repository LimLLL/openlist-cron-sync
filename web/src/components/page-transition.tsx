// 在已认证布局内切换页面，整个布局退出时立即卸载私有内容。
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router';

/** 使用克制的弹簧位移切换路由，减少动态效果时仅淡入淡出。
 * @param props 当前路由内容。
 * @returns 带进入与退出动画的页面容器。
 * @throws 不适用。
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const reducedMotion = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
        transition={{
          type: 'spring',
          stiffness: 320,
          damping: 32,
          opacity: { duration: 0.16 },
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
