// 等宽文本的“解码”动效：字符先随机跳动再从左到右定格，用于 UUID 等标识；读屏软件始终读到原文。
import { useCallback, useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/utils';

const GLYPHS = '0123456789abcdef';
const DURATION_MS = 520;

/** 渲染悬停或首次出现时解码的文本。
 * @param props text 原文；className 附加样式；playOnMount 是否在挂载时播放一次。
 * @returns 文本元素。
 * @throws 不适用。
 */
export function ScrambleText({
  text,
  className,
  playOnMount = false,
}: {
  text: string;
  className?: string;
  playOnMount?: boolean;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const frame = useRef(0);
  const reduced = useReducedMotion() ?? false;

  /** 只改 React 持有的那个文本节点的 nodeValue，不替换节点，后续 props 更新仍然生效。
   * @param value 要显示的字符串。
   * @returns 不适用。
   * @throws 不适用。
   */
  const write = useCallback((value: string) => {
    const textNode = node.current?.firstChild;
    if (textNode) textNode.nodeValue = value;
  }, []);

  const play = useCallback(() => {
    if (reduced || !node.current) return;
    window.cancelAnimationFrame(frame.current);
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / DURATION_MS);
      // 已定格的前缀保持原文，其余字符随机替换；分隔符不参与跳动，宽度稳定。
      const settled = Math.floor(progress * text.length);
      let output = text.slice(0, settled);
      for (let index = settled; index < text.length; index += 1) {
        const char = text[index];
        output += /[0-9a-z]/i.test(char)
          ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
          : char;
      }
      write(output);
      if (progress < 1) frame.current = window.requestAnimationFrame(tick);
    };
    frame.current = window.requestAnimationFrame(tick);
  }, [reduced, text, write]);

  useEffect(() => {
    if (playOnMount) play();
    return () => {
      window.cancelAnimationFrame(frame.current);
      write(text);
    };
  }, [play, playOnMount, text, write]);

  return (
    <span className={cn('font-mono', className)} aria-label={text} onPointerEnter={play}>
      <span ref={node} aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
