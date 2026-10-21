// 全局顶部细进度条：路由分片加载、首次查询与变更期间显示，已有数据的后台轮询不触发。
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useReducedMotion } from 'framer-motion';

/** 当前挂载中的 Suspense 回退数量，供全局进度条订阅。 */
let suspended = 0;
const listeners = new Set<() => void>();

/** 订阅 Suspense 回退计数变化。
 * @param listener 计数变化回调。
 * @returns 取消订阅函数。
 * @throws 不适用。
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 读取当前 Suspense 回退计数。
 * @returns 挂载中的回退数量。
 * @throws 不适用。
 */
function snapshot(): number {
  return suspended;
}

/** 作为 Suspense fallback 使用：不渲染任何内容，只让全局进度条进入加载态。
 * @returns null。
 * @throws 不适用。
 */
export function SuspenseProgress() {
  useEffect(() => {
    suspended += 1;
    listeners.forEach((listener) => listener());
    return () => {
      suspended -= 1;
      listeners.forEach((listener) => listener());
    };
  }, []);
  return null;
}

// 短于该时长的加载不显示，避免快速请求让页面显得更慢。
const SHOW_DELAY_MS = 200;
// 每步推进剩余距离的比例与渐近上限：确定性减速、永不停滞，完成前不到 100%。
const TRICKLE_STEP = 0.12;
const TRICKLE_CEILING = 0.92;
const TRICKLE_INTERVAL_MS = 500;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** 把进度写成前缘位移；用位移而非缩放，前缘光点不会被拉伸。
 * @param element 进度条元素。
 * @param progress 0–1 进度。
 * @returns 不适用。
 * @throws 不适用。
 */
function place(element: HTMLElement, progress: number): void {
  element.style.transform = `translate3d(${((progress - 1) * 100).toFixed(3)}%, 0, 0)`;
}

/** 渲染固定在视口顶部的进度条；进度直接写入 DOM，不产生逐帧 React 渲染。
 * @returns 进度条元素。
 * @throws 不适用。
 */
export function TopProgress() {
  const routePending = useSyncExternalStore(subscribe, snapshot, snapshot);
  // 只统计尚无数据的查询；refetchInterval 的后台刷新不应打扰用户。
  const fetching = useIsFetching({
    predicate: (query) => query.state.status === 'pending',
  });
  const mutating = useIsMutating();
  const busy = routePending + fetching + mutating > 0;
  const reducedMotion = useReducedMotion() ?? false;
  const bar = useRef<HTMLDivElement>(null);
  const shown = useRef(false);

  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    if (busy) {
      let progress = 0;
      let trickle = 0;
      const start = window.setTimeout(() => {
        shown.current = true;
        element.style.transition = 'none';
        place(element, 0);
        element.style.opacity = '1';
        // 强制回流，让归零立即生效后再开始过渡。
        void element.getBoundingClientRect();
        element.style.transition = reducedMotion
          ? 'opacity 150ms ease-out'
          : `transform 600ms ${EASE_OUT}, opacity 150ms ease-out`;
        const step = () => {
          if (document.hidden) return;
          progress += (TRICKLE_CEILING - progress) * TRICKLE_STEP;
          place(element, progress);
        };
        step();
        trickle = window.setInterval(step, TRICKLE_INTERVAL_MS);
      }, SHOW_DELAY_MS);
      return () => {
        window.clearTimeout(start);
        window.clearInterval(trickle);
      };
    }
    if (!shown.current) return;
    // 完成：快速冲满，稍后淡出，淡出结束后无过渡归位。
    shown.current = false;
    element.style.transition = reducedMotion
      ? 'opacity 200ms ease-out 100ms'
      : `transform 200ms ${EASE_OUT}, opacity 200ms ease-out 250ms`;
    place(element, 1);
    element.style.opacity = '0';
    const settle = window.setTimeout(() => {
      element.style.transition = 'none';
      place(element, 0);
    }, 500);
    return () => window.clearTimeout(settle);
  }, [busy, reducedMotion]);

  return (
    <div className="top-progress" aria-hidden="true">
      <div ref={bar} className="top-progress-bar" />
    </div>
  );
}
