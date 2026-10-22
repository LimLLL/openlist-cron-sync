// 数字从当前显示值滚动到新值；文本完全由动画写入 DOM，不产生逐帧渲染，减弱动效时立即显示。
import { useLayoutEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { intlLocale } from '../../i18n';
import { cn } from '../../lib/utils';

/** 按界面语言格式化整数。
 * @param value 数值。
 * @returns 带千位分隔的字符串。
 * @throws 不适用。
 */
function format(value: number): string {
  return new Intl.NumberFormat(intlLocale()).format(Math.round(value));
}

/** 渲染滚动增长的数字；span 不含 React 子节点，避免与动画写入互相覆盖。
 * @param props value 目标值；className 附加样式。
 * @returns 数字元素。
 * @throws 不适用。
 */
export function CountUp({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const node = useRef<HTMLSpanElement>(null);
  // 当前显示的值；被新值打断时从这里继续，不会跳回。
  const shown = useRef(0);
  const reduced = useReducedMotion() ?? false;
  // 订阅语言变化，切换后千位分隔符随之更新。
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
        element.textContent = format(current);
      },
    });
    return () => controls.stop();
  }, [value, reduced, i18n.resolvedLanguage]);

  return <span ref={node} className={cn('tabular-nums', className)} />;
}
