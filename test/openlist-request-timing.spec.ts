// 配额删除后的真实 HTTP 验收：请求期限、显式扫描间隔与两阶段取消。
import { setTimeout as delay } from 'node:timers/promises';
import { AppConfig } from '../src/configuration/app-config.js';
import { Readiness } from '../src/coordination/readiness.js';
import { scanInterval } from '../src/coordination/scan-pacing.service.js';
import {
  componentFixture,
  envelope,
  latch,
  storage,
} from './openlist-fixture.js';
import type { ComponentFixture } from './openlist-fixture.js';

let f: ComponentFixture;
/** 每例释放真实 HTTP、SQLite 与后台任务。
 * @param 不适用。
 * @returns 释放完成。
 * @throws Error 清理失败。
 */
afterEach(async () => {
  if (f) await f.close();
});

/** 已有请求全部阻塞时仍派发更多请求，不再保留实例并发位。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error HTTP 或断言失败。
 */
it('dispatches twelve held reads and an unrelated mutation without a local API ceiling', async () => {
  f = await componentFixture('token');
  await f.client.auth.account(f.record());
  const release = latch();
  f.server.responder = async (call) => {
    if (call.url === '/api/fs/list') await release.promise;
    return undefined;
  };
  const reads = Array.from({ length: 12 }, () =>
    f.client.list(f.record(), '/'),
  );
  try {
    await vi.waitFor(() =>
      expect(
        f.server.calls.filter((c) => c.url === '/api/fs/list'),
      ).toHaveLength(12),
    );
    await f.client.mkdir(f.record(), '/new');
  } finally {
    release.release();
    await Promise.all(reads);
  }
});

/** 间隔大于单请求期限时仍为实际请求保留完整期限。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error HTTP 或断言失败。
 */
it('excludes pacing longer than apiTimeoutMs from the full response budget', async () => {
  f = await componentFixture('token');
  const settings = {
    ...f.app.get(AppConfig).execution,
    apiTimeoutMs: 300,
    retryMaxAttempts: 1,
  };
  const pacing = scanInterval(f.record(), '/drive', 1);
  await f.client.mkdir(f.record(), '/drive/first', { pacing, settings });
  f.server.responder = async (call) => {
    if (call.url === '/api/fs/mkdir') await delay(200);
    return undefined;
  };
  const began = performance.now();
  await f.client.mkdir(f.record(), '/drive/second', { pacing, settings });
  expect(performance.now() - began).toBeGreaterThan(1050);
});

/** 排队取消不进入 submitting；在途取消仅停止后续派发，不截断响应收尾。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error HTTP 或断言失败。
 */
it('separates queued cancellation from in-flight grace', async () => {
  f = await componentFixture('token');
  const pacing = scanInterval(f.record(), '/drive', 1);
  await f.client.mkdir(f.record(), '/drive/first', { pacing });
  const stop = new AbortController();
  const checkpoint = vi.fn();
  const cancelled = f.client.mkdir(f.record(), '/drive/cancelled', {
    pacing,
    dispatchSignal: stop.signal,
    signal: AbortSignal.timeout(5000),
    cleanup: true,
    beforeDispatch: checkpoint,
  });
  const rejected = expect(cancelled).rejects.toBeDefined();
  await delay(30);
  stop.abort();
  await rejected;
  expect(checkpoint).not.toHaveBeenCalled();
  expect(f.server.calls.filter((c) => c.url === '/api/fs/mkdir')).toHaveLength(
    1,
  );
  const entered = latch();
  const release = latch();
  const inflightStop = new AbortController();
  f.server.responder = async (call) => {
    if (call.url === '/api/fs/mkdir') {
      entered.release();
      await release.promise;
    }
    return undefined;
  };
  const running = f.client.mkdir(f.record(), '/drive/next', {
    pacing,
    dispatchSignal: inflightStop.signal,
    signal: AbortSignal.timeout(5000),
    cleanup: true,
    beforeDispatch: checkpoint,
  });
  try {
    await entered.promise;
    inflightStop.abort();
    expect(checkpoint).toHaveBeenCalledTimes(1);
  } finally {
    release.release();
  }
  await running;
});

/** 每个读取尝试独立计时；首次超时不消耗下一次尝试的响应期限。
 * @param succeeds 是否让第二次尝试成功。
 * @returns 验证完成。
 * @throws Error HTTP 或断言失败。
 */
it.each([true, false])(
  'uses fresh request deadlines and bounded read attempts: %s',
  async (succeeds) => {
    f = await componentFixture('token');
    await f.client.auth.account(f.record());
    let attempts = 0;
    f.server.responder = async (call) => {
      if (call.url === '/api/fs/list')
        await delay(++attempts === 2 && succeeds ? 50 : 350);
      return undefined;
    };
    const request = f.client.list(f.record(), '/', '', false, {
      settings: {
        ...f.app.get(AppConfig).execution,
        apiTimeoutMs: 200,
        retryMaxAttempts: 2,
      },
    });
    if (succeeds) await expect(request).resolves.toHaveProperty('items');
    else
      await expect(request).rejects.toMatchObject({
        code: 'OPENLIST_ERROR',
        dispatched: true,
      });
    expect(attempts).toBe(2);
  },
);

/** 超过退避上限的 Retry-After 不得缩短或溢出为立即重试。
 * @param value 上游等待秒数。
 * @returns 验证完成。
 * @throws Error HTTP 或断言失败。
 */
it.each(['2', '9999999999', '9'.repeat(400)])(
  'rejects an oversized Retry-After without replay: %s',
  async (value) => {
    f = await componentFixture('token');
    f.server.responder = (call) =>
      call.url === '/api/fs/list'
        ? { ...envelope(null, 429), headers: { 'retry-after': value } }
        : undefined;
    await expect(f.client.list(f.record(), '/')).rejects.toMatchObject({
      upstreamCode: 429,
    });
    expect(f.server.calls.filter((c) => c.url === '/api/fs/list')).toHaveLength(
      1,
    );
  },
);

/** 调用方期限小于 Retry-After 时保留最后错误，绝不提前再次触网。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error HTTP 或断言失败。
 */
it('returns the last upstream error when the caller expires during Retry-After', async () => {
  f = await componentFixture('token', { RETRY_MAX_MS: '1000' });
  await f.client.auth.account(f.record());
  f.server.responder = (call) =>
    call.url === '/api/fs/list'
      ? { ...envelope(null, 429), headers: { 'retry-after': '1' } }
      : undefined;
  await expect(
    f.client.list(f.record(), '/', '', false, {
      signal: AbortSignal.timeout(100),
    }),
  ).rejects.toMatchObject({ upstreamCode: 429 });
  expect(f.server.calls.filter((c) => c.url === '/api/fs/list')).toHaveLength(
    1,
  );
});

/** 普通读取重试与一次认证重放都重新进入 storage 队列。
 * @param status 首次失败码。
 * @returns 验证完成。
 * @throws Error HTTP 或断言失败。
 */
it.each([500, 401])(
  'paces read retry or authentication replay after %i',
  async (status) => {
    f = await componentFixture('password');
    await f.client.auth.account(f.record());
    const times: number[] = [];
    f.server.responder = (call) => {
      if (call.url !== '/api/fs/list') return;
      times.push(performance.now());
      if (times.length === 1) return envelope(null, status);
      return undefined;
    };
    await f.client.list(f.record(), '/drive', '', false, {
      pacing: scanInterval(f.record(), '/drive', 1),
    });
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(950);
  },
);

/** 关闭立即拒绝扫描排队，cleanup 发起的共享认证也受进程宽限约束。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error HTTP 或断言失败。
 */
it('settles paced waiters on shutdown without submitting', async () => {
  f = await componentFixture('token');
  const pacing = scanInterval(f.record(), '/drive', 3600);
  await f.client.mkdir(f.record(), '/drive/first', { pacing });
  const checkpoint = vi.fn();
  const pending = f.client.mkdir(f.record(), '/drive/next', {
    pacing,
    cleanup: true,
    beforeDispatch: checkpoint,
  });
  const rejected = expect(pending).rejects.toBeDefined();
  await delay(20);
  f.app.get(Readiness).beginShutdown();
  await rejected;
  expect(checkpoint).not.toHaveBeenCalled();
});

/** cleanup 发起的共享登录不能跟随单个等待者取消，也不能越过进程关闭宽限。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error HTTP 或断言失败。
 */
it('bounds shared cleanup authentication by shutdown grace', async () => {
  f = await componentFixture('password', { SHUTDOWN_GRACE_SECONDS: '1' });
  const entered = latch();
  const release = latch();
  f.server.responder = async (call) => {
    if (call.url === '/api/auth/login/hash') {
      entered.release();
      await release.promise;
    }
    return undefined;
  };
  const request = f.client.mkdir(f.record(), '/new', { cleanup: true });
  const rejected = expect(request).rejects.toMatchObject({
    code: 'OPENLIST_ERROR',
  });
  try {
    await entered.promise;
    f.app.get(Readiness).beginShutdown();
    await rejected;
    expect(f.server.calls.some((call) => call.url === '/api/fs/mkdir')).toBe(
      false,
    );
  } finally {
    release.release();
  }
});

/** 多页挂载映射只按每次 HTTP 计时，不再共享一个整表 API 超时。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error HTTP、协议或断言失败。
 */
it('gives every mount-discovery page its own response deadline', async () => {
  f = await componentFixture('token');
  await f.client.auth.account(f.record());
  f.server.responder = async (call) => {
    if (!call.url.startsWith('/api/admin/storage/list')) return undefined;
    await delay(250);
    const page = new URL(call.url, 'http://fixture').searchParams.get('page');
    return envelope({
      total: 101,
      content:
        page === '1'
          ? Array.from({ length: 100 }, (_, index) =>
              storage(index + 1, `/drive-${index + 1}`),
            )
          : [storage(101, '/drive-101')],
    });
  };
  const mounts = await f.client.storages(f.record(), {
    settings: {
      ...f.app.get(AppConfig).execution,
      apiTimeoutMs: 400,
      retryMaxAttempts: 1,
    },
  });
  expect(mounts).toHaveLength(101);
  expect(
    f.server.calls.filter((call) =>
      call.url.startsWith('/api/admin/storage/list'),
    ),
  ).toHaveLength(2);
});
