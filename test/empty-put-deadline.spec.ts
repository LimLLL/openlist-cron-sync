// 使用真实HTTP验证空文件提交期限、停止宽限和持久化错误诊断。
import { setTimeout as delay } from 'node:timers/promises';
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { terminal, plan } from './m2-fixture.js';
import { latch } from './openlist-fixture.js';
import { OpenListMultipart } from '../src/openlist/multipart.service.js';
import { AppConfig } from '../src/configuration/app-config.js';

let f: RelayFixture;
/** 每例建立有短API期限的真实服务。
 * @returns 就绪。
 * @throws Error 初始化失败。
 */
beforeEach(async () => {
  f = await relayFixture({
    OPENLIST_API_TIMEOUT_MS: '1000',
    CANCEL_GRACE_SECONDS: '1',
    SHUTDOWN_GRACE_SECONDS: '1',
  });
});
/** 释放连接、应用和临时数据库。
 * @returns 清理完成。
 * @throws Error 清理失败。
 */
afterEach(async () => {
  await f.close();
});

/** 慢提交超过普通API期限仍取得成功，不能提前取消上游。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('waits for a slow empty commit beyond the ordinary API deadline', async () => {
  f.files.set('/source/new.txt', Buffer.alloc(0));
  f.fault = async (call, response) => {
    if (call.url === '/api/fs/put') await delay(1250);
    return response;
  };
  const run = await terminal(
    f,
    f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: false }).id,
  );
  expect(run.status).toBe('succeeded');
  expect(plan(f, run.id)[0].status).toBe('succeeded');
  expect(
    f.server.calls.filter((call) => call.url === '/api/fs/put'),
  ).toHaveLength(1);
});

/** 已提交PUT在取消宽限内返回成功，超过宽限则保持unknown且不自动重试。
 * @param answers 是否在宽限内响应。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it.each([true, false])(
  'preserves two-phase cancellation for empty PUT (answers=%s)',
  async (answers) => {
    f.files.set('/source/new.txt', Buffer.alloc(0));
    const entered = latch();
    const release = latch();
    f.fault = async (call, response) => {
      if (call.url === '/api/fs/put') {
        entered.release();
        await release.promise;
      }
      return response;
    };
    const run = f
      .runs()
      .trigger(f.job().id, { dryRun: false, confirmDeletes: false });
    try {
      await entered.promise;
      f.runs().cancel(run.id);
      if (answers) release.release();
      const done = await terminal(f, run.id);
      expect(done.status).toBe('cancelled');
      const op = plan(f, run.id)[0];
      expect(op.status).toBe(answers ? 'succeeded' : 'unknown');
      if (!answers)
        expect(op.error?.message).toContain(
          'PUT /api/fs/put: caller deadline or cancellation',
        );
      expect(
        f.server.calls.filter((call) => call.url === '/api/fs/put'),
      ).toHaveLength(1);
    } finally {
      release.release();
    }
  },
);

/** transport的调用方期限仍会中断空文件，普通API超时则明确标注且剥离query。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('distinguishes caller and API deadlines without exposing request query data', async () => {
  await f.client.auth.account(f.record());
  const release = latch();
  f.fault = async (call, response) => {
    if (
      call.url === '/api/fs/put' ||
      call.url.startsWith('/api/fs/multipart/status?')
    )
      await release.promise;
    return response;
  };
  const settings = {
    ...f.app.get(AppConfig).execution,
    apiTimeoutMs: 100,
    retryMaxAttempts: 1,
  };
  try {
    await expect(
      f.app
        .get(OpenListMultipart)
        .putEmpty(
          f.record(),
          { directory: '/target', name: 'secret-name' },
          { settings, signal: AbortSignal.timeout(150) },
        ),
    ).rejects.toMatchObject({
      code: 'OPENLIST_ERROR',
      dispatched: true,
      message: 'OpenList PUT /api/fs/put: caller deadline or cancellation',
    });
    await expect(
      f.app
        .get(OpenListMultipart)
        .status(f.record(), 'private-upload-id', { settings }),
    ).rejects.toMatchObject({
      code: 'OPENLIST_ERROR',
      dispatched: true,
      message:
        'OpenList GET /api/fs/multipart/status: per-attempt API timeout after 100 ms',
    });
  } finally {
    release.release();
  }
});

/** 进程关闭不提前丢弃在途成功响应，关闭后Run仍由恢复收尾。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('preserves successful empty PUT evidence received during shutdown grace', async () => {
  f.files.set('/source/new.txt', Buffer.alloc(0));
  const entered = latch();
  const release = latch();
  f.fault = async (call, response) => {
    if (call.url === '/api/fs/put') {
      entered.release();
      await release.promise;
    }
    return response;
  };
  const run = f
    .runs()
    .trigger(f.job().id, { dryRun: false, confirmDeletes: false });
  await entered.promise;
  const closing = f.app.close();
  release.release();
  await closing;
  f.fault = undefined;
  await f.restart();
  const done = await terminal(f, run.id);
  expect(done.status).toBe('interrupted');
  expect(plan(f, run.id)[0].status).toBe('succeeded');
});
