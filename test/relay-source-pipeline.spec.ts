// 验证源EOF释放与目标complete解耦，使用真实HTTP、SQLite和可控上游阻塞。
import { setTimeout as delay } from 'node:timers/promises';
import { eq, sql } from 'drizzle-orm';
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { latch, envelope } from './openlist-fixture.js';
import { plan, preview, terminal } from './m2-fixture.js';
import { RelayService } from '../src/relay/relay.service.js';
import { BLOCK_BYTES, Spool } from '../src/relay/spool.js';
import type { PreparedTransfer } from '../src/relay/relay-types.js';
import { OperationStore } from '../src/sync/operation-store.js';
import { Executor } from '../src/sync/executor.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { operations } from '../src/database/operation-schema.js';
import { runs } from '../src/database/run-schema.js';
import { RelayResources } from '../src/coordination/relay-resources.js';

// 仅心跳用例缩短固定60秒等待；网络、spool、取消宽限和其它退避继续使用真实时钟。
const heartbeatClock = vi.hoisted(() => ({ milliseconds: 60000 }));
vi.mock('node:timers/promises', async (original) => {
  const timers = await original<typeof import('node:timers/promises')>();
  return {
    ...timers,
    setTimeout: (
      milliseconds: number,
      value: unknown,
      options: { signal?: AbortSignal } = {},
    ) =>
      timers.setTimeout(
        milliseconds === 60000 ? heartbeatClock.milliseconds : milliseconds,
        value,
        options,
      ),
  };
});

/** 每例独立资源，所有阻塞由门闩或取消显式释放。 */
describe('relay source pipeline', () => {
  let f: RelayFixture;
  /** 建立真实上游与应用。
   * @returns 夹具就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    heartbeatClock.milliseconds = 60000;
    f = await relayFixture();
  });
  /** 关闭本例资源并恢复观测替身。
   * @returns 清理完成。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    vi.restoreAllMocks();
    await f.close();
  });
  /** complete全部阻塞仍能持续补充文件，源响应并发始终不超过用户设置。
   * @returns 验证完成。
   * @throws Error 传输或断言失败。
   */
  it('reaches five blocked completes with only two source responses and stops idle progress writes', async () => {
    f.files.delete('/source/new.txt');
    const sizes = [12, BLOCK_BYTES, BLOCK_BYTES * 2 + 7, 100, BLOCK_BYTES + 1];
    sizes.forEach((size, index) =>
      f.files.set(`/source/${index}.txt`, Buffer.alloc(size)),
    );
    const firstPair = latch();
    const release = latch();
    let reading = 0;
    let maximum = 0;
    let completes = 0;
    const transfers: PreparedTransfer[] = [];
    const relay = f.app.get(RelayService);
    const prepare = relay.prepare.bind(relay);
    vi.spyOn(relay, 'prepare').mockImplementation(async (...args) => {
      const transfer = await prepare(...args);
      transfers.push(transfer);
      return transfer;
    });
    const bytes = vi.spyOn(OperationStore.prototype, 'bytes');
    f.fault = async (call, response) => {
      if (call.url.startsWith('/d/')) {
        return {
          ...response,
          /** 保持前两个真实源响应同时打开，之后每个响应都记录完整生命周期。
           * @param output 源HTTP响应。
           * @returns 响应已发送。
           * @throws Error 夹具类型错误。
           */
          stream: async (output) => {
            reading++;
            maximum = Math.max(maximum, reading);
            if (reading === 2) firstPair.release();
            let closed = false;
            const end = () => {
              if (!closed) {
                closed = true;
                reading--;
              }
            };
            output.once('finish', end);
            output.once('close', end);
            await firstPair.promise;
            if (!Buffer.isBuffer(response.body))
              throw new Error('Missing payload');
            output.end(response.body);
          },
        };
      }
      if (call.url.endsWith('/complete')) {
        completes++;
        await release.promise;
      }
      return response;
    };
    try {
      const job = f.job({
        sourceDownloadConcurrency: 2,
        targets: [{ instanceId: f.id, path: '/target', concurrentFiles: 0 }],
      });
      const run = f
        .runs()
        .trigger(job.id, { dryRun: false, confirmDeletes: false });
      await vi.waitFor(() => expect(completes).toBe(5), { timeout: 5000 });
      expect(maximum).toBe(2);
      expect(reading).toBe(0);
      expect(transfers).toHaveLength(5);
      for (const transfer of transfers) {
        expect(transfer.download.verifiedEOF).toBe(true);
        expect(transfer.download.input.signal.aborted).toBe(true);
        expect(transfer.first.length).toBe(0);
        expect(transfer.blocks.size).toBe(0);
      }
      expect(f.runs().get(run.id).stats.transferredBytes).toBe(
        sizes.reduce((a, b) => a + b, 0),
      );
      const persisted = bytes.mock.calls.length;
      await delay(5200);
      expect(bytes.mock.calls).toHaveLength(persisted);
      release.release();
      expect((await terminal(f, run.id)).stats.succeededCreates).toBe(5);
    } finally {
      firstPair.release();
      release.release();
    }
  }, 15000);
  /** 最后chunk仍在等待确认时，EOF已经允许后续源读取。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('starts another download while the previous final chunk is blocked', async () => {
    f.files.set('/source/new.txt', Buffer.alloc(BLOCK_BYTES + 7));
    f.files.set('/source/second.txt', Buffer.from('second'));
    const release = latch();
    let finals = 0;
    f.fault = async (call, response) => {
      if (
        call.url.endsWith('/chunk') &&
        call.headers['x-chunk-index'] === '1'
      ) {
        finals++;
        await release.promise;
      }
      return response;
    };
    try {
      const job = f.job({
        sourceDownloadConcurrency: 1,
        targets: [{ instanceId: f.id, path: '/target', concurrentFiles: 0 }],
      });
      const run = f
        .runs()
        .trigger(job.id, { dryRun: false, confirmDeletes: false });
      await vi.waitFor(() =>
        expect(f.files.get('/target/second.txt')).toEqual(
          Buffer.from('second'),
        ),
      );
      expect(finals).toBe(1);
      expect(f.runs().get(run.id).status).toBe('executing');
      release.release();
      expect((await terminal(f, run.id)).status).toBe('succeeded');
    } finally {
      release.release();
    }
  });
  /** 已读完的小文件在旧文件删除及init之前释放源位；0字节仍走同步put。
   * @param size 源文件大小。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it.each([0, 12, BLOCK_BYTES])(
    'releases a prepared %i-byte source before replacement deletion',
    async (size) => {
      f.files.set('/source/new.txt', Buffer.alloc(size));
      f.files.set('/source/second.txt', Buffer.from('second'));
      f.files.set('/target/new.txt', Buffer.alloc(size + 1));
      const release = latch();
      const deleting = latch();
      f.fault = async (call, response) => {
        if (call.url === '/api/fs/remove') {
          deleting.release();
          await release.promise;
        }
        return response;
      };
      try {
        const job = f.job({
          sourceDownloadConcurrency: 1,
          targets: [{ instanceId: f.id, path: '/target', concurrentFiles: 0 }],
        });
        const run = f
          .runs()
          .trigger(job.id, { dryRun: false, confirmDeletes: true });
        await deleting.promise;
        await vi.waitFor(() =>
          expect(f.files.get('/target/second.txt')).toEqual(
            Buffer.from('second'),
          ),
        );
        expect(
          f.server.calls.some((call) =>
            call.url.startsWith('/d/source/new.txt'),
          ),
        ).toBe(true);
        release.release();
        expect((await terminal(f, run.id)).status).toBe('succeeded');
        expect(f.files.get('/target/new.txt')).toEqual(Buffer.alloc(size));
      } finally {
        release.release();
      }
    },
  );
  /** 分片失败中止仍在读取的源，归还源位先于可能很慢的远端abort。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it.each(['chunk', 'heartbeat'] as const)(
    'interrupts a blocked read on %s failure before remote abort returns',
    async (failure) => {
      f.files.set('/source/new.txt', Buffer.alloc(3 * BLOCK_BYTES));
      f.files.set('/source/second.txt', Buffer.from('second'));
      const aborting = latch();
      const release = latch();
      let sourceClosed = false;
      let failedSession = '';
      if (failure === 'heartbeat') heartbeatClock.milliseconds = 25;
      f.fault = async (call, response) => {
        if (
          call.url.endsWith('/init') &&
          decodeURIComponent(String(call.headers['file-path'])) ===
            '/target/new.txt'
        ) {
          failedSession = (response.body as { data: { upload_id: string } })
            .data.upload_id;
        }
        if (call.url.startsWith('/d/source/new.txt'))
          return {
            ...response,
            stream: async (output) => {
              output.once('close', () => {
                sourceClosed = true;
              });
              output.write(Buffer.alloc(BLOCK_BYTES));
            },
          };
        if (
          failure === 'chunk' &&
          call.url.endsWith('/chunk') &&
          !sourceClosed
        ) {
          const body = response.body as { data: Record<string, unknown> };
          return envelope({ ...body.data, state: 'failed_permanent' }, 500);
        }
        if (
          failure === 'heartbeat' &&
          call.url.includes('/multipart/status?') &&
          call.url.includes(failedSession)
        )
          return envelope(null, 404);
        if (call.url.endsWith('/abort')) {
          aborting.release();
          await release.promise;
        }
        return response;
      };
      try {
        const job = f.job({
          sourceDownloadConcurrency: 1,
          targets: [{ instanceId: f.id, path: '/target', concurrentFiles: 0 }],
        });
        const run = f
          .runs()
          .trigger(job.id, { dryRun: false, confirmDeletes: false });
        await aborting.promise;
        await vi.waitFor(() =>
          expect(f.files.get('/target/second.txt')).toEqual(
            Buffer.from('second'),
          ),
        );
        expect(sourceClosed).toBe(true);
        release.release();
        const result = await terminal(f, run.id);
        expect(result.status).toBe('partial');
        expect(result.error).toBeNull();
      } finally {
        release.release();
      }
    },
  );
  /** 源仍未读完时取消，不能等删除响应宽限结束才归还源配额。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('releases a cancelled source while replacement removal is still waiting for its response', async () => {
    f.files.set('/source/new.txt', Buffer.alloc(2 * BLOCK_BYTES));
    f.files.set('/target/new.txt', Buffer.from('old'));
    const deleting = latch();
    const release = latch();
    f.fault = async (call, response) => {
      if (call.url === '/api/fs/remove') {
        deleting.release();
        await release.promise;
      }
      return response;
    };
    try {
      const job = f.job({ sourceDownloadConcurrency: 1 });
      const run = f
        .runs()
        .trigger(job.id, { dryRun: false, confirmDeletes: true });
      await deleting.promise;
      f.runs().cancel(run.id);
      const next = await f.app
        .get(RelayResources)
        .relayFile(job.id, 'probe', 1, 0, AbortSignal.timeout(1000));
      expect(f.runs().get(run.id).status).toBe('cancelling');
      next.source();
      next.target();
      release.release();
      expect((await terminal(f, run.id)).status).toBe('cancelled');
    } finally {
      release.release();
    }
  });
  /** 多块源必须验证真正EOF，不能因读够计划大小而开放最后chunk或记成功。
   * @param fault 源响应损坏方式。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it.each(['short', 'long', 'broken-eof'] as const)(
    'refuses the final chunk for a %s source',
    async (fault) => {
      const size = BLOCK_BYTES + 7;
      f.files.set('/source/new.txt', Buffer.alloc(size));
      f.fault = (call, response) => {
        if (!call.url.startsWith('/d/')) return response;
        return {
          headers: { 'content-type': 'application/octet-stream' },
          stream: async (output) => {
            if (fault === 'broken-eof') {
              output.write(Buffer.alloc(size));
              await delay(10);
              output.destroy();
            } else
              output.end(Buffer.alloc(fault === 'short' ? size - 1 : size + 1));
          },
        };
      };
      const run = await terminal(
        f,
        f.runs().trigger(f.job({ sourceDownloadConcurrency: 1 }).id, {
          dryRun: false,
          confirmDeletes: false,
        }).id,
      );
      const op = plan(f, run.id)[0];
      expect(op.status).toBe('failed');
      expect(op.multipart?.sourceStreamCompletedAt).toBeNull();
      expect(
        f.server.calls.some(
          (call) =>
            call.url.endsWith('/chunk') &&
            call.headers['x-chunk-index'] === '1',
        ),
      ).toBe(false);
      expect(
        f.server.calls.some((call) => call.url.endsWith('/complete')),
      ).toBe(false);
    },
  );
  /** EOF后的整个文件重试重新读取源，仍由原逻辑协调器持有重试行。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('reacquires source capacity on a whole-file retry without duplicate dispatch', async () => {
    const respond = f.server.responder;
    let failed = false;
    f.server.responder = async (call) => {
      if (call.url.endsWith('/chunk') && !failed) {
        failed = true;
        const response = await respond?.(call);
        if (
          !response ||
          typeof response.body !== 'object' ||
          response.body === null
        )
          throw new Error('Missing session');
        const body = response.body as { data: Record<string, unknown> };
        return envelope({ ...body.data, state: 'failed_retriable' }, 500);
      }
      return respond?.(call);
    };
    const job = f.job({
      retryCount: 1,
      sourceDownloadConcurrency: 1,
      targets: [{ instanceId: f.id, path: '/target', concurrentFiles: 0 }],
    });
    const run = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
    );
    expect(run.status, JSON.stringify(plan(f, run.id))).toBe('succeeded');
    expect(
      f.server.calls.filter((call) => call.url.startsWith('/d/')),
    ).toHaveLength(2);
    expect(plan(f, run.id).filter((op) => op.action === 'create')).toHaveLength(
      2,
    );
    expect(run.stats.retryAttempts).toBe(1);
  });
  /** 最小可用spool仍允许多个EOF文件等待complete，预读不会占住等待源位的空间。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('progresses with a one-block spool and two source slots', async () => {
    f.files.set('/source/new.txt', Buffer.alloc(3 * BLOCK_BYTES));
    f.files.set('/source/second.txt', Buffer.alloc(3 * BLOCK_BYTES));
    const spool = f.app.get(Spool);
    // statfs反映已写入payload；用实际发布/删除量模拟只有一块可用空间。
    let held = 0;
    const publish = spool.publish.bind(spool);
    const releaseBlock = spool.release.bind(spool);
    vi.spyOn(spool, 'available').mockImplementation(
      async () => BLOCK_BYTES - held,
    );
    vi.spyOn(spool, 'publish').mockImplementation(async (...args) => {
      const block = await publish(...args);
      held += block.size;
      return block;
    });
    vi.spyOn(spool, 'release').mockImplementation(async (blocks) => {
      await releaseBlock(blocks);
      held -= blocks.reduce((n, block) => n + block.size, 0);
    });
    const job = f.job({
      sourceDownloadConcurrency: 2,
      targets: [{ instanceId: f.id, path: '/target', concurrentFiles: 0 }],
    });
    expect(
      (
        await terminal(
          f,
          f.runs().trigger(job.id, { dryRun: false, confirmDeletes: false }).id,
        )
      ).status,
    ).toBe('succeeded');
    expect(held).toBe(0);
  });
  /** 大计划在两个读者阻塞时仅启动一个额外准备者，不把十万行转换成等待中的Promise。
   * @returns 验证完成。
   * @throws Error SQL、执行或断言失败。
   */
  it('keeps initial admission and keyset reads bounded for 100k pending operations', async () => {
    const job = f.job({
      sourceDownloadConcurrency: 2,
      targets: [{ instanceId: f.id, path: '/target', concurrentFiles: 0 }],
    });
    const planned = await preview(f, job);
    const db = f.app.get(DatabaseService).db;
    const original = db
      .select()
      .from(operations)
      .where(eq(operations.runId, planned.id))
      .get();
    if (!original) throw new Error('Missing plan');
    db.run(sql`WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n < 99999)
      INSERT INTO operations(id,run_id,run_target_id,seq,action,method,reason,status,source_instance_id,source_path,
        target_instance_id,target_path,is_dir,expected_source_size,affected_file_count,affected_bytes,created_at,updated_at)
      SELECT 'lazy-' || n, ${planned.id}, ${original.runTargetId}, n+1000,'create','relay','new','pending',
        ${f.id},'/source/new.txt',${f.id},'/target/lazy-' || n,0,12,1,12,${Date.now()},${Date.now()} FROM numbers`);
    const run = db.select().from(runs).where(eq(runs.id, planned.id)).get();
    if (!run) throw new Error('Missing Run');
    let downloads = 0;
    f.fault = (call, response) =>
      call.url.startsWith('/d/')
        ? {
            ...response,
            stream: async (output) => {
              downloads++;
              output.flushHeaders();
            },
          }
        : response;
    const pending = vi.spyOn(OperationStore.prototype, 'pending');
    const prepare = vi.spyOn(f.app.get(RelayService), 'prepare');
    const stop = new AbortController();
    const execution = f.app
      .get(Executor)
      .execute(run, stop.signal)
      .catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(downloads).toBe(2));
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(3));
      const pages = pending.mock.calls.length;
      await delay(100);
      expect(prepare).toHaveBeenCalledTimes(3);
      expect(pending).toHaveBeenCalledTimes(pages);
      expect(
        pending.mock.results.every(
          (result) => Array.isArray(result.value) && result.value.length <= 32,
        ),
      ).toBe(true);
    } finally {
      stop.abort(new Error('Stop blocked readers'));
      expect(await execution).toBeInstanceOf(Error);
    }
  }, 15000);
});
