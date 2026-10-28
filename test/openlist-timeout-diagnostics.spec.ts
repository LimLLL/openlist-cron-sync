// 在HTTP依赖边界注入Undici期限事实，验证诊断不会因较晚的取消而误分类。
import * as undici from 'undici';
import { componentFixture } from './openlist-fixture.js';
import type { ComponentFixture } from './openlist-fixture.js';
import { AppConfig } from '../src/configuration/app-config.js';

// 保留真实Agent及其他协议，仅在测试需要时替换一次HTTP调用。
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, request: vi.fn(actual.request) };
});

let f: ComponentFixture;
/** 预先完成认证，故障只作用于被测请求。
 * @returns 就绪。
 * @throws Error 初始化失败。
 */
beforeEach(async () => {
  f = await componentFixture('token');
  await f.client.auth.account(f.record());
});
/** 恢复HTTP依赖并释放资源。
 * @returns 清理完成。
 * @throws Error 清理失败。
 */
afterEach(async () => {
  vi.restoreAllMocks();
  await f.close();
});

/** 底层具体超时不能被收尾时才发生的signal取消覆盖；不转发错误原文。
 * @param error Undici公开错误类型。
 * @param message 期望的受控摘要。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it.each([
  [
    new undici.errors.ConnectTimeoutError('private host'),
    'connection timeout after 300 ms',
  ],
  [
    new undici.errors.HeadersTimeoutError('private query'),
    'response headers timeout after 500 ms',
  ],
  [
    new undici.errors.BodyTimeoutError('private body'),
    'response body timeout after 500 ms',
  ],
])('reports %s without leaking upstream text', async (error, message) => {
  const stop = new AbortController();
  vi.mocked(undici.request).mockImplementationOnce(async () => {
    // 请求已经以底层期限失败，模拟交付错误之前调用方同时结束。
    stop.abort();
    throw error;
  });
  await expect(
    f.client.mkdir(f.record(), '/private-file', {
      signal: stop.signal,
      settings: {
        ...f.app.get(AppConfig).execution,
        apiTimeoutMs: 500,
        connectTimeoutMs: 300,
      },
    }),
  ).rejects.toMatchObject({
    code: 'OPENLIST_ERROR',
    dispatched: true,
    message: `OpenList POST /api/fs/mkdir: ${message}`,
  });
});

/** 已派发请求的网络错误不能被只用于阻止新派发的信号误分类。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('keeps a dispatched network failure distinct from cancellation before dispatch', async () => {
  const dispatch = new AbortController();
  vi.mocked(undici.request).mockImplementationOnce(async () => {
    dispatch.abort();
    throw new Error('private network details');
  });
  await expect(
    f.client.mkdir(f.record(), '/private-file', {
      dispatchSignal: dispatch.signal,
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({
    code: 'OPENLIST_ERROR',
    dispatched: true,
    message: 'OpenList POST /api/fs/mkdir: network request failed',
  });
});
