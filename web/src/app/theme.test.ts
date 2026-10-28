// 验证首帧脚本与运行时主题一致，以及系统变化、跨标签页和存储不可用时的行为。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hook = vi.hoisted(() => ({
  subscribe: null as null | ((listener: () => void) => () => void),
  snapshot: null as null | (() => string),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useSyncExternalStore: (
    subscribe: typeof hook.subscribe,
    snapshot: () => string,
  ) => {
    hook.subscribe = subscribe;
    hook.snapshot = snapshot;
    return snapshot();
  },
}));

let stored: string | null;
let dark: boolean;
let media: EventTarget & { matches: boolean };
let browser: EventTarget & { matchMedia: () => typeof media };
let cleanup: (() => void) | undefined;
const storage = {
  getItem: vi.fn(() => stored),
  setItem: vi.fn((_key: string, value: string) => {
    stored = value;
  }),
  removeItem: vi.fn(() => {
    stored = null;
  }),
};
const documentStub = {
  documentElement: {
    classList: {
      toggle: (_name: string, value: boolean) => {
        dark = value;
      },
    },
  },
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  stored = null;
  dark = false;
  media = Object.assign(new EventTarget(), { matches: false });
  browser = Object.assign(new EventTarget(), { matchMedia: () => media });
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', documentStub);
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

/** 订阅实际主题store，仅替换React挂载边界。
 * @returns 主题公共接口。
 * @throws Error 模块导入失败。
 */
async function subscribeTheme() {
  const theme = await import('./theme');
  theme.useThemePreference();
  cleanup = hook.subscribe!(() => {});
  return theme;
}

describe('theme behavior', () => {
  it.each([
    [null, false],
    [null, true],
    ['invalid', true],
    ['light', true],
    ['dark', false],
  ] as const)(
    'keeps pre-paint and runtime behavior aligned for %s / OS dark=%s',
    async (preference, systemDark) => {
      stored = preference;
      media.matches = systemDark;
      const html = readFileSync(
        new URL('../../index.html', import.meta.url),
        'utf8',
      );
      const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
      runInNewContext(script, {
        window: browser,
        document: documentStub,
        localStorage: storage,
      });
      const prePaint = dark;
      await subscribeTheme();
      expect(dark).toBe(prePaint);
      expect(dark).toBe(
        preference === 'dark' || (preference !== 'light' && systemDark),
      );
    },
  );

  it('follows OS and cross-tab changes while respecting the manual override', async () => {
    const theme = await subscribeTheme();
    media.matches = true;
    media.dispatchEvent(new Event('change'));
    expect(dark).toBe(true);
    theme.setThemePreference('light');
    media.dispatchEvent(new Event('change'));
    expect(dark).toBe(false);
    theme.setThemePreference('system');
    expect(stored).toBeNull();
    expect(dark).toBe(true);
    stored = 'light';
    browser.dispatchEvent(
      Object.assign(new Event('storage'), { key: 'ocs_theme' }),
    );
    expect(hook.snapshot!()).toBe('light');
    expect(dark).toBe(false);
    stored = null;
    browser.dispatchEvent(Object.assign(new Event('storage'), { key: null }));
    expect(hook.snapshot!()).toBe('system');
    expect(dark).toBe(true);
  });

  it('keeps manual switching usable when storage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
      removeItem: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
    const theme = await subscribeTheme();
    theme.setThemePreference('dark');
    expect(dark).toBe(true);
    expect(hook.snapshot!()).toBe('dark');
  });
});
