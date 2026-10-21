// 磁吸包裹层：精确指针悬停时子元素朝指针方向轻微偏移，离开后以弹簧回位；触屏与减弱动效下不启用。
import { useRef } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { cn } from '../../lib/utils';

const SPRING = { stiffness: 260, damping: 18, mass: 0.6 };

/** 渲染磁吸效果容器。
 * @param props children 子元素；strength 偏移比例（相对指针到中心的距离）；className 附加样式。
 * @returns 带弹簧位移的行内块。
 * @throws 不适用。
 */
export function Magnetic({
  children,
  strength = 0.22,
  className,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const box = useRef<HTMLSpanElement>(null);
  const x = useSpring(useMotionValue(0), SPRING);
  const y = useSpring(useMotionValue(0), SPRING);

  /** 按指针相对中心的偏移设置位移目标。
   * @param event 指针事件。
   * @returns 不适用。
   * @throws 不适用。
   */
  function onMove(event: PointerEvent<HTMLSpanElement>): void {
    if (reduced || event.pointerType !== 'mouse' || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    x.set((event.clientX - rect.left - rect.width / 2) * strength);
    y.set((event.clientY - rect.top - rect.height / 2) * strength);
  }

  /** 指针离开后回到原位。
   * @returns 不适用。
   * @throws 不适用。
   */
  function onLeave(): void {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.span
      ref={box}
      className={cn('inline-flex', className)}
      style={{ x, y }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      {children}
    </motion.span>
  );
}
