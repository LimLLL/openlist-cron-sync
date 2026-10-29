// 用真实 Run/HTTP 验证扫描间隔覆盖、观察豁免与 Target 执行容量。
import { eq } from 'drizzle-orm';
import { setTimeout as delay } from 'node:timers/promises';
import { m2Fixture, listing, terminal, preview, plan } from './m2-fixture.js';
import { relayFixture } from './relay-fixture.js';
import { file, latch } from './openlist-fixture.js';
import { object } from '../src/openlist/errors.js';
import { Executor } from '../src/sync/executor.service.js';
import { CopyFile } from '../src/sync/copy-file.js';
import { CopyTracker } from '../src/sync/copy-tracker.js';
import { OperationStore } from '../src/sync/operation-store.js';
import { DatabaseService } from '../src/database/database.service.js';
import { runTargets } from '../src/database/run-schema.js';
import { operations } from '../src/database/operation-schema.js';
import { ScanPacing } from '../src/coordination/scan-pacing.service.js';
import { executionRecord } from '../src/database/operation-records.js';

/** 两个 Job 的独立目录落在同一 storage，实际 Run 扫描共享开始时间。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error Run 或断言失败。
 */
it('shares source scan pacing across concurrently running jobs', async () => {
  const f = await m2Fixture();
  try {
    const times: number[] = [];
    const responder = f.server.responder;
    f.server.responder = (call) => {
      if (
        call.url === '/api/fs/list' &&
        String(object(call.json).path).startsWith('/drive/')
      )
        times.push(performance.now());
      return responder?.(call);
    };
    for (const name of ['a', 'b']) {
      f.tree.set(`/drive/${name}`, listing(file()));
      f.tree.set(`/photos/${name}`, listing());
    }
    const jobs = ['a', 'b'].map((name) =>
      f.job({
        source: { instanceId: f.id, path: `/drive/${name}` },
        sourceScanIntervalSeconds: 1,
        targets: [{ instanceId: f.id, path: `/photos/${name}` }],
      }),
    );
    const runs = jobs.map((job) =>
      f.runs().trigger(job.id, { dryRun: true, confirmDeletes: false }),
    );
    const results = await Promise.all(runs.map((run) => terminal(f, run.id)));
    expect(results.every((run) => run.status === 'succeeded')).toBe(true);
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(950);
  } finally {
    await f.close();
  }
});

/** 源及多个 Target 仅角色不同，首段相同时不能建立各自的间隔池。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error Run 或断言失败。
 */
it('shares starts across source and multiple targets on the same storage', async () => {
  const f = await m2Fixture();
  try {
    for (const name of ['source', 'one', 'two'])
      f.tree.set(`/drive/${name}`, listing(file()));
    const times: number[] = [];
    const responder = f.server.responder;
    f.server.responder = (call) => {
      if (call.url === '/api/fs/list') times.push(performance.now());
      return responder?.(call);
    };
    await preview(
      f,
      f.job({
        source: { instanceId: f.id, path: '/drive/source' },
        sourceScanIntervalSeconds: 1,
        targets: ['one', 'two'].map((name) => ({
          instanceId: f.id,
          path: `/drive/${name}`,
          scanIntervalSeconds: 1,
        })),
      }),
    );
    expect(times).toHaveLength(3);
    for (let i = 1; i < times.length; i++)
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(950);
  } finally {
    await f.close();
  }
});

/** 观察调用即使使用 fs/list 也不继承目标 pacing；目录验证显式使用冻结的目标间隔。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error HTTP、数据库或断言失败。
 */
it('paces explicit directory reads but exempts entry checks and server-copy source validation', async () => {
  const f = await m2Fixture();
  try {
    const run = await preview(
      f,
      f.copyJob({
        sourceScanIntervalSeconds: 3600,
        targets: [
          {
            instanceId: f.id,
            path: '/target',
            createMode: 'server_copy',
            scanIntervalSeconds: 3600,
          },
        ],
      }),
    );
    const db = f.app.get(DatabaseService).db;
    const record = f.runs().record(run.id);
    const target = db
      .select()
      .from(runTargets)
      .where(eq(runTargets.runId, run.id))
      .get();
    const op = db
      .select()
      .from(operations)
      .where(eq(operations.runId, run.id))
      .get();
    if (!target || !op) throw new Error('Missing planned records');
    const stop = new AbortController();
    const context = f.app.get(Executor).context(record, stop.signal);
    const pacing = vi.spyOn(f.app.get(ScanPacing), 'acquire');
    await context.entry(target, '/target/missing.txt');
    await new CopyFile(
      context,
      new OperationStore(db, record),
      f.app.get(CopyTracker),
    ).source(target, executionRecord(db, op.id)!);
    expect(pacing).not.toHaveBeenCalled();
    const directory = context.list(target, '/target', 'directory');
    const rejected = expect(directory).rejects.toBeDefined();
    await vi.waitFor(() => expect(pacing).toHaveBeenCalledTimes(1));
    expect(pacing.mock.calls[0][0].seconds).toBe(3600);
    stop.abort();
    await rejected;
  } finally {
    vi.restoreAllMocks();
    await f.close();
  }
});

/** 文件 prepare 阶段与 extras 阶段都严格遵守同一个 Target 配置，0 跨越多个读取批次。
 * @param phase 本例挂起的 mkdir 或文件 delete。
 * @param capacity Target 并发；0 表示不限。
 * @returns 验证完成。
 * @throws Error Run、HTTP 或断言失败。
 */
it.each([
  ['mkdir', 3],
  ['mkdir', 0],
  ['remove', 3],
  ['remove', 0],
] as const)(
  'uses target concurrentFiles for %s at %i across fetch batches',
  async (phase, capacity) => {
    const f = await relayFixture();
    const release = latch();
    let runId: string | undefined;
    try {
      f.files.delete('/source/new.txt');
      for (let i = 0; i < 70; i++)
        f.files.set(
          phase === 'mkdir' ? `/source/dir-${i}` : `/target/file-${i}`,
          phase === 'mkdir' ? null : Buffer.from('x'),
        );
      let started = 0;
      f.fault = async (call, response) => {
        if (call.url === `/api/fs/${phase}`) {
          started++;
          await release.promise;
        }
        return response;
      };
      const job = f.job({
        allowEmptySource: true,
        syncEmptyDirs: true,
        targets: [
          {
            instanceId: f.id,
            path: '/target',
            mode: 'mirror',
            concurrentFiles: capacity,
          },
        ],
      });
      runId = f
        .runs()
        .trigger(job.id, { dryRun: false, confirmDeletes: true }).id;
      await vi.waitFor(() => expect(started).toBe(capacity || 70), {
        timeout: 5000,
      });
      await delay(30);
      expect(started).toBe(capacity || 70);
      release.release();
      expect((await terminal(f, runId)).status).toBe('succeeded');
      expect(started).toBe(70);
    } finally {
      release.release();
      if (runId) await terminal(f, runId);
      await f.close();
    }
  },
  15000,
);

/** Run 停止撤销尚未派发的 mkdir，即使请求使用在途 grace 也不等待一小时。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error Run 或断言失败。
 */
it('cancels a mutation waiting on its target interval without submitting it', async () => {
  const f = await relayFixture();
  try {
    f.files.set('/source/empty', null);
    const job = f.job({
      syncEmptyDirs: true,
      targets: [
        { instanceId: f.id, path: '/target', scanIntervalSeconds: 3600 },
      ],
    });
    const run = f
      .runs()
      .trigger(job.id, { dryRun: false, confirmDeletes: false });
    await vi.waitFor(() =>
      expect(f.runs().get(run.id).status).toBe('executing'),
    );
    f.runs().cancel(run.id);
    expect((await terminal(f, run.id)).status).toBe('cancelled');
    expect(f.server.calls.some((c) => c.url === '/api/fs/mkdir')).toBe(false);
    expect(plan(f, run.id).filter((op) => op.action === 'mkdir')).toHaveLength(
      1,
    );
    expect(
      plan(f, run.id)
        .filter((op) => op.action === 'mkdir')
        .every((op) => op.submittedAt === null),
    ).toBe(true);
  } finally {
    await f.close();
  }
});

/** 目录 extras 即使目标文件并发为零也逐个确认，不能同时提交多个目录 delete。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error Run 或断言失败。
 */
it('keeps directory extras serial with unlimited target files', async () => {
  const f = await relayFixture();
  const release = latch();
  try {
    f.files.delete('/source/new.txt');
    for (const name of ['a', 'b', 'c']) f.files.set(`/target/${name}`, null);
    let started = 0;
    f.fault = async (call, response) => {
      if (call.url === '/api/fs/remove') {
        started++;
        await release.promise;
      }
      return response;
    };
    const run = f.runs().trigger(
      f.job({
        allowEmptySource: true,
        syncEmptyDirs: true,
        targets: [
          {
            instanceId: f.id,
            path: '/target',
            mode: 'mirror',
            concurrentFiles: 0,
          },
        ],
      }).id,
      { dryRun: false, confirmDeletes: true },
    );
    await vi.waitFor(() => expect(started).toBe(1));
    await delay(50);
    expect(started).toBe(1);
    release.release();
    expect((await terminal(f, run.id)).status).toBe('succeeded');
    expect(started).toBe(3);
  } finally {
    release.release();
    await f.close();
  }
});
