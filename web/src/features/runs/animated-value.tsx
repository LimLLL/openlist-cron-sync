// 带自定义格式的滚动数值（如字节量）；文本由动画直接写入 DOM，减弱动效时立即显示。
import { useLayoutEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

/** 渲染从当前显示值滚动到目标值的数字。
 * @param props value 目标值；format 格式化函数；className 附加样式。
 * @returns 不含 React 子节点的 span，避免与动画写入互相覆盖。
 * @throws 不适用。
 */
export function AnimatedValue({
  value,
  format,
  className,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const reduced = useReducedMotion() ?? false;
  // 语言切换后单位与分隔符随之更新。
  const { i18n } = useTranslation();

  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    if (reduced) {
      shown.current = value;
      element.textContent = format(value);
      return;
    }
    element.textContent = format(shown.current);
    const controls = animate(shown.current, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (current) => {
        shown.current = current;
        element.textContent = format(Math.round(current));
      },
    });
    return () => controls.stop();
  }, [value, reduced, format, i18n.resolvedLanguage]);

  return <span ref={node} className={className} />;
}
