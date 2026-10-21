// 用真实 provider、请求客户端与 QueryClient 验证存储及取消；只手动执行 SSR 不会运行的 effect。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth-context';
import type { Session } from './auth-context';

const lifecycle = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: (setup: () => void | (() => void)) =>
    lifecycle.effects.push(setup),
}));

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const records = new Map<string, string>();
const storage = {
  getItem: (key: string) => records.get(key) ?? null,
  setItem: (key: string, value: string) => records.set(key, value),
  removeItem: (key: string) => records.delete(key),
};
let browser: EventTarget;
let cleanups: (() => void)[];
let auth: ReturnType<typeof useAuth>;
const fetchMock = vi.fn<typeof fetch>();

/** 生成符合服务端最长一天 TTL 的会话。
 * @param token 测试令牌。
 * @returns 可恢复会话。
 * @throws 不适用。
 */
function session(token = 'original'): Session {
  return {
    accessToken: token,
    username: 'admin',
    expiresAt: Date.now() + 60_000,
    mustChangePassword: false,
  };
}

/** 读取真实 Context 并捕获本次挂载的公开操作。
 * @returns 不渲染内容。
 * @throws 不适用。
 */
function Consumer() {
  auth = useAuth();
  return null;
}

/** 挂载 provider 并启动其计时器和存储监听。
 * @returns 不适用。
 * @throws 渲染异常。
 */
function mount(): void {
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(AuthProvider, { children: createElement(Consumer) }),
    ),
  );
  cleanups = lifecycle.effects
    .map((setup) => setup())
    .filter((value) => typeof value === 'function');
}

/** 分发其他标签页的存储通知，允许模拟已经过时的事件值。
 * @param key 发生变化的键，null 代表 clear()。
 * @param newValue 事件携带的值。
 * @returns 不适用。
 * @throws 不适用。
 */
function notifyStorage(
  key: string | null = 'ocs_session',
  newValue: string | null = null,
): void {
  browser.dispatchEvent(
    Object.assign(new Event('storage'), {
      key,
      newValue,
      storageArea: storage,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-21T00:00:00Z'));
  lifecycle.effects = [];
  cleanups = [];
  records.clear();
  client.clear();
  browser = new EventTarget();
  vi.stubGlobal('window', Object.assign(browser, { setTimeout, clearTimeout }));
  vi.stubGlobal('localStorage', storage);
  fetchMock.mockReset().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('persisted auth lifecycle', () => {
  it('restores a session and keeps its controller usable after StrictMode effect replay', async () => {
    storage.setItem('ocs_session', JSON.stringify(session()));
    mount();
    expect(auth.session?.accessToken).toBe('original');
    cleanups.forEach((cleanup) => cleanup());
    cleanups = lifecycle.effects
      .map((setup) => setup())
      .filter((value) => typeof value === 'function');
    await auth.request('/jobs', { parse: String });
    const options = fetchMock.mock.calls[0][1];
    expect(new Headers(options?.headers).get('Authorization')).toBe(
      'Bearer original',
    );
    expect(options?.signal?.aborted).toBe(false);
  });

  it.each([
    '',
    '{',
    'null',
    '{"expiresAt":1e400}',
    'empty-username',
    'bad-token',
    'expired',
    'distant-expiry',
  ])('clears invalid stored sessions: %s', (example) => {
    const data = session();
    let raw = example;
    if (example === 'empty-username')
      raw = JSON.stringify({ ...data, username: '' });
    if (example === 'bad-token')
      raw = JSON.stringify({ ...data, accessToken: '\n' });
    if (example === 'expired')
      raw = JSON.stringify({ ...data, expiresAt: Date.now() });
    if (example === 'distant-expiry')
      raw = JSON.stringify({ ...data, expiresAt: Date.now() + 2 ** 32 });
    mountWith(raw);
    expect(auth.session).toBeNull();
    expect(storage.getItem('ocs_session')).toBeNull();
  });

  it('rejects numeric overflow even when every other stored field is valid', () => {
    mountWith(
      JSON.stringify(session()).replace(/"expiresAt":\d+/, '"expiresAt":1e400'),
    );
    expect(auth.session).toBeNull();
    expect(storage.getItem('ocs_session')).toBeNull();
  });

  it.each(['ocs_session', null])(
    'ends requests and clears caches on cross-tab removal (%s)',
    async (key) => {
      mountWith(JSON.stringify(session()));
      client.setQueryData(['private'], 'data');
      client.getMutationCache().build(client, { mutationKey: ['private'] });
      let finish: (value: Response) => void = () => {};
      fetchMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = auth
        .request('/jobs', { parse: String })
        .catch((error: unknown) => error);
      storage.removeItem('ocs_session');
      notifyStorage(key);
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(client.getQueryCache().getAll()).toHaveLength(0);
      expect(client.getMutationCache().getAll()).toHaveLength(0);
      finish(Response.json({ secret: 'old result' }));
      expect(await pending).toMatchObject({ name: 'AbortError' });
      await expect(
        auth.request('/jobs', { parse: String }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    },
  );

  it('uses the latest stored login instead of replaying an obsolete logout event', async () => {
    mountWith(JSON.stringify(session()));
    client.setQueryData(['private'], 'old');
    storage.setItem('ocs_session', JSON.stringify(session('new')));
    notifyStorage('ocs_session', null);
    await auth.request('/jobs', { parse: String });
    expect(
      new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization'),
    ).toBe('Bearer new');
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it.each(['TOKEN_REVOKED', 'PASSWORD_CHANGE_REQUIRED'])(
    'does not overwrite a newer tab login after an old %s response',
    async (code) => {
      mountWith(JSON.stringify(session()));
      storage.setItem('ocs_session', JSON.stringify(session('new')));
      fetchMock.mockResolvedValueOnce(
        Response.json(
          { error: { code, message: 'Rejected' } },
          { status: 401 },
        ),
      );
      await expect(
        auth.request('/jobs', { parse: String }),
      ).rejects.toMatchObject({ code });
      expect(
        JSON.parse(storage.getItem('ocs_session') ?? '{}').accessToken,
      ).toBe('new');
    },
  );

  it('expires before sending a request even when the background timer has not run', async () => {
    mountWith(JSON.stringify(session()));
    vi.setSystemTime(Date.now() + 60_001);
    await expect(
      auth.request('/jobs', { parse: String }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.getItem('ocs_session')).toBeNull();
  });

  it('persists a successful login, records forced password change and clears it on logout', async () => {
    mount();
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          accessToken: 'new',
          tokenType: 'Bearer',
          expiresIn: 300,
          mustChangePassword: false,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ id: 1, username: 'admin', mustChangePassword: false }),
      );
    await auth.login('admin', 'long password', new AbortController().signal);
    expect(JSON.parse(storage.getItem('ocs_session') ?? '{}')).toMatchObject({
      accessToken: 'new',
      mustChangePassword: false,
    });
    fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: 'PASSWORD_CHANGE_REQUIRED',
            message: 'Change password',
          },
        },
        { status: 403 },
      ),
    );
    await expect(
      auth.request('/jobs', { parse: String }),
    ).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    expect(
      JSON.parse(storage.getItem('ocs_session') ?? '{}').mustChangePassword,
    ).toBe(true);
    auth.logout();
    expect(storage.getItem('ocs_session')).toBeNull();
  });

  it('keeps a login usable in memory and removes the old stored token when persistence fails', async () => {
    mountWith(JSON.stringify(session()));
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          accessToken: 'new',
          tokenType: 'Bearer',
          expiresIn: 300,
          mustChangePassword: false,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ id: 1, username: 'admin', mustChangePassword: false }),
      );
    await auth.login('admin', 'long password', new AbortController().signal);
    await auth.request('/jobs', { parse: String });
    expect(
      new Headers(fetchMock.mock.calls[2][1]?.headers).get('Authorization'),
    ).toBe('Bearer new');
    expect(storage.getItem('ocs_session')).toBeNull();
  });

  it('removes storage listeners and timers on cleanup', async () => {
    mountWith(JSON.stringify(session()));
    cleanups.forEach((cleanup) => cleanup());
    cleanups = [];
    expect(vi.getTimerCount()).toBe(0);
    storage.removeItem('ocs_session');
    notifyStorage();
    await auth.request('/jobs', { parse: String });
  });
});

/** 保存测试记录后挂载。
 * @param raw 原始存储 JSON。
 * @returns 不适用。
 * @throws 渲染异常。
 */
function mountWith(raw: string): void {
  storage.setItem('ocs_session', raw);
  mount();
}
