// 真实HTTP与SQLite验证文件配额、持续补充、无限复制及multipart控制通道。
import { relayFixture } from './relay-fixture.js';
import { copyFixture } from './copy-fixture.js';
import { terminal, plan } from './m2-fixture.js';
import { envelope, latch } from './openlist-fixture.js';
import { object } from '../src/openlist/errors.js';
import { InstancesService } from '../src/instances/instances.service.js';
import { ApiQuota } from '../src/coordination/api-quota.service.js';
import { OpenListMultipart } from '../src/openlist/multipart.service.js';
import { RelayResources } from '../src/coordination/relay-resources.js';

/** 慢文件不能阻止其他文件完成后立即补充；执行中统计读取已落库字节。
 * @returns 验证完成。
 * @throws Error 夹具或断言失败。
 */
it('refills relay slots while a slow first file remains in flight', async () => {
  const f = await relayFixture();
  const entered = latch();
  const release = latch();
  try {
    f.files.delete('/source/new.txt');
    for (let index = 0; index < 7; index++)
      f.files.set(`/source/${index}.txt`, Buffer.from('payload'));
    f.fault = async (call, response) => {
      if (call.url.startsWith('/d/source/0.txt')) {
        entered.release();
        await release.promise;
      }
      return response;
    };
    const job = f.job({
      sourceDownloadConcurrency: 3,
      targets: [{ instanceId: f.id, path: '/target', concurrentFiles: 3 }],
    });
    const run = f
      .runs()
      .trigger(job.id, { dryRun: false, confirmDeletes: false });
    await entered.promise;
    await vi.waitFor(() =>
      expect(f.runs().get(run.id).stats.succeededCreates).toBe(6),
    );
    expect(f.runs().get(run.id)).toMatchObject({
      status: 'executing',
      stats: { transferredBytes: 42, downloadedBytes: 42 },
    });
    release.release();
    expect((await terminal(f, run.id)).stats.succeededCreates).toBe(7);
  } finally {
    release.release();
    await f.close();
  }
});

/** 无限配额必须跨越读取批次提交，不能等待首批远程任务完成。
 * @returns 验证完成。
 * @throws Error 夹具或断言失败。
 */
it('submits more than two fetch batches with unlimited server-copy files', async () => {
  const f = await copyFixture();
  try {
    f.app.get(InstancesService).patch(f.id, {
      limits: { maxApiConcurrency: 0, apiRequestsPerSecond: 0 },
    });
    f.files.delete('/source/new.txt');
    for (let index = 0; index < 70; index++)
      f.files.set(`/source/${index}.txt`, Buffer.from('payload'));
    f.initialState = 1;
    const job = f.copyJob({
      targets: [
        {
          instanceId: f.id,
          path: '/target',
          createMode: 'server_copy',
          concurrentFiles: 0,
        },
      ],
    });
    const run = f
      .runs()
      .trigger(job.id, { dryRun: false, confirmDeletes: false });
    await vi.waitFor(() => expect(f.copyCount).toBe(70), { timeout: 5000 });
    expect(
      plan(f, run.id).filter((op) => op.status === 'succeeded'),
    ).toHaveLength(0);
    f.runs().cancel(run.id);
    expect((await terminal(f, run.id)).status).toBe('cancelled');
  } finally {
    await f.close();
  }
});

/** 单文件窗口由Target控制，窗口内的慢分片不能让下一文件突破配额。
 * @param concurrency 本例Target的chunkConcurrency。
 * @returns 验证完成。
 * @throws Error 夹具或断言失败。
 */
it.each([1, 3, 8])(
  'uses a per-file chunk window of %i',
  async (concurrency) => {
    const f = await relayFixture();
    const release = latch();
    try {
      f.files.set('/source/new.txt', Buffer.alloc(10 * 1024 * 1024));
      let chunks = 0;
      f.fault = async (call, response) => {
        if (call.url.endsWith('/chunk')) {
          chunks++;
          await release.promise;
        }
        return response;
      };
      const job = f.job({
        targets: [
          { instanceId: f.id, path: '/target', chunkConcurrency: concurrency },
        ],
      });
      const run = f
        .runs()
        .trigger(job.id, { dryRun: false, confirmDeletes: false });
      await vi.waitFor(() => expect(chunks).toBe(concurrency));
      expect(f.runs().get(run.id).status).toBe('executing');
      if (concurrency === 3) {
        await vi.waitFor(
          () =>
            expect(f.runs().get(run.id).stats.transferredBytes).toBe(
              3 * 1024 * 1024,
            ),
          { timeout: 6500, interval: 100 },
        );
        expect(f.runs().get(run.id).stats.succeededCreates).toBe(0);
      }
      release.release();
      expect((await terminal(f, run.id)).status).toBe('succeeded');
      expect(chunks).toBe(10);
    } finally {
      release.release();
      await f.close();
    }
  },
  15_000,
);

/** 控制位全部被占时chunk/complete仍可完成，status/abort必须等待API配额。
 * @returns 验证完成。
 * @throws Error 请求或断言失败。
 */
it('keeps chunk and complete outside the API quota while status and abort use it', async () => {
  const f = await relayFixture();
  let release: (() => void) | undefined;
  try {
    f.app.get(InstancesService).patch(f.id, {
      limits: { maxApiConcurrency: 1, apiRequestsPerSecond: 0 },
    });
    const instance = f.record();
    const multipart = f.app.get(OpenListMultipart);
    const quota = f.app.get(ApiQuota);
    const signal = AbortSignal.timeout(5000);
    const session = await multipart.init(
      instance,
      { directory: '/target', name: 'quota.txt' },
      1,
      { signal },
    );
    release = await quota.acquire(instance, true, signal);
    const requests = f.server.calls.length;
    const status = multipart
      .status(instance, session.uploadId, { signal })
      .catch((error: unknown) => error);
    const abort = multipart
      .abort(instance, session.uploadId, { signal })
      .catch((error: unknown) => error);
    await multipart.chunk(
      instance,
      session.uploadId,
      0,
      Buffer.from('x'),
      signal,
    );
    await multipart.complete(instance, session.uploadId, signal);
    expect(f.server.calls.slice(requests).map((call) => call.url)).toEqual([
      '/api/fs/multipart/chunk',
      '/api/fs/multipart/complete',
    ]);
    release();
    release = undefined;
    await Promise.all([status, abort]);
    expect(
      f.server.calls.some((call) => call.url.includes('/multipart/status')),
    ).toBe(true);
    expect(
      f.server.calls.some((call) => call.url.endsWith('/multipart/abort')),
    ).toBe(true);
  } finally {
    release?.();
    await f.close();
  }
});

/** 文件并发10必须允许十个complete同时等待，不能退回隐藏的4文件批次。
 * @returns 验证完成。
 * @throws Error 夹具或断言失败。
 */
it('holds ten configured file slots through complete', async () => {
  const f = await relayFixture();
  const release = latch();
  try {
    f.files.delete('/source/new.txt');
    for (let index = 0; index < 12; index++)
      f.files.set(`/source/${index}.txt`, Buffer.from('payload'));
    let completes = 0;
    f.fault = async (call, response) => {
      if (call.url.endsWith('/complete')) {
        completes++;
        await release.promise;
      }
      return response;
    };
    const job = f.job({
      sourceDownloadConcurrency: 10,
      targets: [{ instanceId: f.id, path: '/target', concurrentFiles: 10 }],
    });
    const run = f
      .runs()
      .trigger(job.id, { dryRun: false, confirmDeletes: false });
    await vi.waitFor(() => expect(completes).toBe(10));
    expect(
      plan(f, run.id).filter((op) => op.status === 'running'),
    ).toHaveLength(10);
    release.release();
    expect((await terminal(f, run.id)).stats.succeededCreates).toBe(12);
  } finally {
    release.release();
    await f.close();
  }
});

/** Job源配额在多个Target间共享，不同Job独立。
 * @returns 验证完成。
 * @throws Error 配额等待或断言失败。
 */
it('shares source permits within a Job and adds concurrency across Jobs', async () => {
  const resources = new RelayResources();
  const signal = AbortSignal.timeout(5000);
  const first = await resources.relayFile('job-a', 'a-first', 1, 0, signal);
  let admitted = false;
  const waiting = resources
    .relayFile('job-a', 'a-second', 1, 0, signal)
    .then((release) => {
      admitted = true;
      return release;
    });
  const other = await resources.relayFile('job-b', 'b-target', 1, 0, signal);
  expect(admitted).toBe(false);
  first();
  (await waiting)();
  other();
});

/** 父mkdir重试后，早于重试seq的子目录必须再次变为可派发，且重试只有一个owner。
 * @returns 验证完成。
 * @throws Error 夹具或断言失败。
 */
it('requeries children after a parent mkdir retry without duplicate dispatch', async () => {
  const f = await relayFixture({ RETRY_BASE_MS: '100', RETRY_MAX_MS: '100' });
  try {
    f.files.set('/source/dir', null);
    f.files.set('/source/dir/child', null);
    f.files.set('/source/dir/child/nested.txt', Buffer.from('nested'));
    const respond = f.server.responder;
    let parentCalls = 0;
    f.server.responder = async (call) => {
      if (
        call.url === '/api/fs/mkdir' &&
        object(call.json).path === '/target/dir'
      ) {
        parentCalls++;
        if (parentCalls === 1) return envelope(null, 500);
      }
      return respond?.(call);
    };
    const run = f.runs().trigger(f.job({ retryCount: 1 }).id, {
      dryRun: false,
      confirmDeletes: false,
    });
    const result = await terminal(f, run.id);
    expect(result.status).toBe('succeeded');
    expect(result.stats.retryAttempts).toBe(1);
    expect(parentCalls).toBe(2);
    expect(f.files.get('/target/dir/child/nested.txt')).toEqual(
      Buffer.from('nested'),
    );
  } finally {
    await f.close();
  }
});
