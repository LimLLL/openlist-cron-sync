// 验证进度条的真实计时逻辑；以 QueryClient 提供查询状态，只替换 DOM/ref 挂载边界。
import { QueryClient } from '@tanstack/react-query';
import type { QueryFilters } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SuspenseProgress, TopProgress } from './top-progress';

const hooks = vi.hoisted(() => ({
  setup: null as (() => void | (() => void)) | null,
  element: {
    style: { transform: '', opacity: '', transition: '' },
    getBoundingClientRect: () => ({}),
  },
  shown: { current: false },
  mutating: 0,
  reduced: false,
}));
const client = new QueryClient();
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: (setup: () => void | (() => void)) => {
    hooks.setup = setup;
  },
  useRef: (initial: unknown) =>
    initial === null ? { current: hooks.element } : hooks.shown,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
    snapshot(),
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useIsFetching: (filters: QueryFilters) => client.isFetching(filters),
  useIsMutating: () => hooks.mutating,
}));
let cleanup: void | (() => void);

/** 执行一次忙碌状态变化对应的 effect，保留已显示状态与 DOM。
 * @returns 不适用。
 * @throws 不适用。
 */
function update(): void {
  cleanup?.();
  TopProgress();
  cleanup = hooks.setup?.();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    matchMedia: () => ({ matches: hooks.reduced }),
  });
  vi.stubGlobal('document', { hidden: false });
  client.clear();
  hooks.shown.current = false;
  hooks.mutating = 0;
  hooks.reduced = false;
  hooks.element.style = { transform: '', opacity: '', transition: '' };
  cleanup = undefined;
});
afterEach(() => {
  cleanup?.();
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('top progress lifecycle', () => {
  it('shows initial fetching queries, but ignores cached polling and disabled pending queries', () => {
    const query = client.getQueryCache().build(client, { queryKey: ['runs'] });
    update();
    vi.advanceTimersByTime(250);
    expect(hooks.element.style.opacity).toBe('');
    query.setState({ status: 'pending', fetchStatus: 'fetching' });
    update();
    vi.advanceTimersByTime(200);
    expect(hooks.element.style.opacity).toBe('1');
    query.setState({ status: 'success', data: [], fetchStatus: 'fetching' });
    update();
    vi.advanceTimersByTime(500);
    expect(hooks.element.style.opacity).toBe('0');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not flash for work that completes before the delay', () => {
    hooks.mutating = 1;
    update();
    vi.advanceTimersByTime(199);
    hooks.mutating = 0;
    update();
    vi.advanceTimersByTime(1000);
    expect(hooks.element.style.opacity).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an old completion reset when new work starts during the sweep', () => {
    hooks.mutating = 1;
    update();
    vi.advanceTimersByTime(700);
    hooks.mutating = 0;
    update();
    vi.advanceTimersByTime(100);
    hooks.mutating = 1;
    update();
    vi.advanceTimersByTime(450);
    expect(hooks.element.style.opacity).toBe('1');
    expect(hooks.element.style.transform).not.toBe(
      'translate3d(-100.000%, 0, 0)',
    );
    cleanup?.();
    cleanup = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('balances nested Suspense fallbacks and StrictMode setup/cleanup replay', () => {
    SuspenseProgress();
    const setup = hooks.setup!;
    const first = setup();
    first?.();
    const replay = setup();
    const second = setup();
    update();
    vi.advanceTimersByTime(200);
    replay?.();
    update();
    vi.advanceTimersByTime(200);
    expect(hooks.element.style.opacity).toBe('1');
    second?.();
    update();
    vi.advanceTimersByTime(500);
    expect(hooks.element.style.opacity).toBe('0');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans timers when reduced motion changes or the component unmounts', () => {
    hooks.mutating = 1;
    update();
    vi.advanceTimersByTime(200);
    hooks.reduced = true;
    update();
    vi.advanceTimersByTime(200);
    expect(vi.getTimerCount()).toBe(1);
    cleanup?.();
    cleanup = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });
});
