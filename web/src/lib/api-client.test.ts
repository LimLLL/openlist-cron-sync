// 验证浏览器请求契约与失败边界，不通过实现细节或样式断言替代行为。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from './api-client';
import { parseAdministrator } from '../features/auth/auth-contract';

/** 恢复每个测试替换的浏览器 fetch。
 * @returns 不适用。
 * @throws 不适用。
 */
afterEach(() => vi.unstubAllGlobals());

describe('API client', () => {
  it('sends bearer auth only to the API and forwards cancellation', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json({ id: 1, username: 'admin', mustChangePassword: false }),
      );
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    await expect(
      apiRequest('/auth/me', {
        token: 'test-token',
        signal: controller.signal,
        parse: parseAdministrator,
      }),
    ).resolves.toEqual({ id: 1, username: 'admin', mustChangePassword: false });
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/v1/auth/me');
    const options = fetch.mock.calls[0]?.[1];
    expect(new Headers(options?.headers).get('Authorization')).toBe(
      'Bearer test-token',
    );
    expect(options).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    expect(new Headers(options?.headers).has('Content-Type')).toBe(false);
  });

  it('accepts a 204 password change without trying to read JSON', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      apiRequest('/auth/change-password', {
        method: 'POST',
        token: 'test-token',
        body: {
          currentPassword: 'previous-password',
          newPassword: 'replacement-password',
        },
      }),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Content-Type'),
    ).toBe('application/json');
  });

  it('retains field errors, request ID and retry timing without retrying', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: 'LOGIN_RATE_LIMITED',
            message: 'Too many attempts',
            details: [
              { field: 'username', reason: 'Invalid value' },
              'bad detail',
            ],
          },
        },
        {
          status: 429,
          headers: { 'retry-after': '60', 'x-request-id': 'request-1' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      apiRequest('/auth/login', { method: 'POST' }),
    ).rejects.toMatchObject({
      status: 429,
      code: 'LOGIN_RATE_LIMITED',
      requestId: 'request-1',
      retryAfter: 60,
      details: [{ field: 'username', reason: 'Invalid value' }],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports an unexpected HTML response without rendering its body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<html>private proxy information</html>'),
        ),
    );
    await expect(
      apiRequest('/auth/me', { parse: parseAdministrator }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'The server returned an unexpected response.',
    });
  });

  it('preserves cancellation rather than converting it into a network error', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(controller.signal.reason));
    await expect(
      apiRequest('/auth/me', {
        signal: controller.signal,
        parse: parseAdministrator,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a late JSON response after its session has been cancelled', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        controller.abort();
        return Response.json({
          id: 1,
          username: 'admin',
          mustChangePassword: false,
        });
      }),
    );
    await expect(
      apiRequest('/auth/me', {
        signal: controller.signal,
        parse: parseAdministrator,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('normalizes network failures without leaking transport details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('private network details')),
    );
    const failure = apiRequest('/auth/me', { parse: parseAdministrator });
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });
});
