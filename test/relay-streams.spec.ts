// 验证下载续传、受控跳转及磁盘背压确实驱动真实HTTP流水线。
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { terminal, plan } from './m2-fixture.js';
import { F1Server, latch } from './openlist-fixture.js';
import { Spool } from '../src/relay/spool.js';
import { BandwidthBucket, Permits } from '../src/coordination/permits.js';
import { RelayResources } from '../src/coordination/relay-resources.js';

/** 注册传输资源和HTTP行为测试。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M3 streaming resources', () => {
  let f: RelayFixture;
  /** 用例隔离，不依赖宿主磁盘实际容量。
   * @param 不适用。
   * @returns 夹具就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await relayFixture({ RETRY_MAX_ATTEMPTS: '3' });
  });
  /** 恢复磁盘观测替身再清理资源。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    vi.restoreAllMocks();
    await f.close();
  });
  /** 只统计当前测试的真实spool文件字节，模拟小文件系统可用量。
   * @param path 当前测试目录。
   * @returns 文件总字节数。
   * @throws Error 文件系统失败。
   */
  async function used(path: string): Promise<number> {
    let bytes = 0;
    for (const item of await readdir(path, { withFileTypes: true })) {
      const child = join(path, item.name);
      try {
        bytes += item.isDirectory()
          ? await used(child)
          : (await stat(child)).size;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        )
          throw error;
      }
    }
    return bytes;
  }
  /** 多文件均大于spool，仍能释放已确认块持续推进。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('makes progress with two files much larger than the available spool', async () => {
    f.files.set('/source/new.txt', Buffer.alloc(5 * 1048576 + 3, 11));
    f.files.set('/source/other.txt', Buffer.alloc(5 * 1048576 + 7, 22));
    vi.spyOn(f.app.get(Spool), 'available').mockImplementation(
      /** 用真实块占用模拟仅有3MiB的spool文件系统。
       * @param 不适用。
       * @returns 模拟文件系统的可用字节数。
       * @throws Error 读取本测试spool失败。
       */
      async () => 3 * 1048576 - (await used(join(f.directory.path, 'spool'))),
    );
    const run = await terminal(
      f,
      f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: false }).id,
    );
    expect(run.status).toBe('succeeded');
    expect(run.stats.succeededCreates).toBe(2);
    const actual = f.files.get('/target/other.txt');
    const expected = f.files.get('/source/other.txt');
    expect(
      Buffer.isBuffer(actual) &&
        Buffer.isBuffer(expected) &&
        actual.equals(expected),
    ).toBe(true);
  });
  /** Range必须从已写完首块恢复；忽略Range可丢弃前缀，validator变化和416必须停止。
   * @param mode 续传HTTP响应类型。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it.each(['206', '200', '416', 'changed', 'size-changed'] as const)(
    'handles resumed source response %s with If-Range',
    async (mode) => {
      const reservations = vi.spyOn(f.app.get(RelayResources), 'relayFile');
      const data = Buffer.alloc(2 * 1048576 + 31, 31);
      f.files.set('/source/new.txt', data);
      f.files.set('/target/new.txt', Buffer.from('old'));
      const removed = latch();
      let cut = false;
      f.fault =
        /** 在删除开始后切断源响应，稳定触发Range续传。
         * @param call 真实HTTP请求及其捕获头。
         * @param response 正常响应；stream回调时为测试HTTP响应。
         * @returns 本故障窗口对应的响应；其它请求保持原响应。
         * @throws 不适用。
         */
        (call, response) => {
          if (call.url === '/api/fs/remove') removed.release();
          if (call.url.startsWith('/d/') && call.headers.range) {
            if (mode === '416') return { status: 416, body: '' };
            if (mode === 'size-changed')
              return {
                ...response,
                headers: {
                  ...response.headers,
                  'content-length': String(data.length - 1048576 + 1),
                },
              };
            if (mode === 'changed')
              return {
                ...response,
                headers: { ...response.headers, etag: '"changed"' },
              };
            if (mode === '200')
              return {
                status: 200,
                body: data,
                headers: {
                  'content-type': 'application/octet-stream',
                  'content-length': String(data.length),
                  etag: '"fixture"',
                },
              };
          }
          if (call.url.startsWith('/d/') && !cut) {
            cut = true;
            return {
              headers: {
                'content-type': 'application/octet-stream',
                'content-length': String(data.length),
                etag: '"fixture"',
              },
              /** 首块可以完整到达；删除开始后再断流，稳定产生恢复偏移。
               * @param response 测试HTTP响应。
               * @returns 断流完成。
               * @throws Error 测试门闩失败。
               */
              stream: async (response) => {
                response.write(data.subarray(0, 1048576));
                await removed.promise;
                response.destroy();
              },
            };
          }
          return response;
        };
      const result = await terminal(
        f,
        f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: true })
          .id,
      );
      if (mode === '206' || mode === '200') {
        expect(result.status).toBe('succeeded');
        expect(reservations).toHaveBeenCalledTimes(1);
        const actual = f.files.get('/target/new.txt');
        expect(Buffer.isBuffer(actual) && actual.equals(data)).toBe(true);
      } else {
        expect(plan(f, result.id)[1]).toMatchObject({
          status: 'failed',
          error: { code: 'SOURCE_CHANGED' },
        });
      }
      expect(
        f.server.calls.some(
          /** 识别从首块末尾续传且携带强If-Range的请求。
           * @param call 真实HTTP请求及其捕获头。
           * @returns 满足上述请求或操作条件时返回true。
           * @throws 不适用。
           */
          (call) =>
            call.headers.range === 'bytes=1048576-' &&
            call.headers['if-range'] === '"fixture"',
        ),
      ).toBe(true);
    },
  );
  /** 下载跳转不能携带管理凭据，对端401不触发账号重新登录。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言或服务器清理失败。
   */
  it('follows a cross-origin download redirect without sending API credentials', async () => {
    const cloud = await new F1Server().start();
    cloud.responder =
      /** 提供独立origin上的源文件内容。
       * @param 不适用。
       * @returns 当前测试文件的响应内容。
       * @throws 不适用。
       */
      () => ({
        body: Buffer.from('hello relay!'),
        headers: { 'content-type': 'application/octet-stream' },
      });
    f.fault =
      /** 把源下载重定向到独立origin以检验凭据隔离。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws 不适用。
       */
      (call, response) =>
        call.url.startsWith('/d/')
          ? {
              status: 302,
              headers: { location: cloud.baseUrl + '/file' },
              body: '',
            }
          : response;
    try {
      const result = await terminal(
        f,
        f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: false })
          .id,
      );
      expect(result.status).toBe('succeeded');
      expect(cloud.calls).toHaveLength(1);
      expect(cloud.calls[0].headers.authorization).toBeUndefined();
      expect(cloud.calls[0].headers.cookie).toBeUndefined();
      expect(cloud.calls[0].headers['proxy-authorization']).toBeUndefined();
    } finally {
      await cloud.close();
    }
  });
  /** 极低带宽下请求大小不超过桶容量，等待可取消。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('cancels token and permit waits without losing capacity', async () => {
    const bucket = new BandwidthBucket(1);
    const stop = new AbortController();
    expect(await bucket.take(65536, stop.signal)).toBe(1);
    const waiting = bucket.take(65536, stop.signal);
    stop.abort();
    await expect(waiting).rejects.toThrow();
    const permits = new Permits(1);
    const release = await permits.acquire(new AbortController().signal);
    const cancelled = new AbortController();
    const queued = permits.acquire(cancelled.signal);
    cancelled.abort();
    await expect(queued).rejects.toThrow();
    release();
    const next = await permits.acquire(new AbortController().signal);
    next();
  });
});
