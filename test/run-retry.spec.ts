// 真实Nest、SQLite和HTTP验证范围重试；历史结果直接写库以覆盖中断窗口。
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { preview, terminal, plan } from './m2-fixture.js';
import { DatabaseService } from '../src/database/database.service.js';
import { operations } from '../src/database/operation-schema.js';
import { runs, runRetryItems } from '../src/database/run-schema.js';
import { HistoryRetention } from '../src/maintenance/history-retention.js';
import { object } from '../src/openlist/errors.js';
import { latch } from './openlist-fixture.js';

let f: RelayFixture;
/** 创建真实协议和数据库夹具。
 * @returns 就绪。
 * @throws Error 初始化失败。
 */
beforeEach(async () => {
  f = await relayFixture({ RUN_RETENTION_DAYS: '1' });
});
/** 释放所有测试资源。
 * @returns 清理完成。
 * @throws Error 清理失败。
 */
afterEach(async () => {
  await f.close();
});
/** 用真实完整规划生成历史，再模拟全部动作未成功的正式终态。
 * @param overrides 当前Job配置差异。
 * @returns Job与父Run ID。
 * @throws Error 规划或持久化失败。
 */
async function history(overrides: Record<string, unknown> = {}) {
  const job = f.job(overrides);
  const run = await preview(f, job);
  const db = f.app.get(DatabaseService).db;
  db.update(runs)
    .set({ dryRun: false, status: 'failed' })
    .where(eq(runs.id, run.id))
    .run();
  db.update(operations)
    .set({ status: 'failed', endedAt: Date.now() })
    .where(eq(operations.runId, run.id))
    .run();
  return { job, id: run.id };
}
/** 读取本轮所有范围输入，不依赖实现内部树结构。
 * @param id Run ID。
 * @returns 持久化范围。
 * @throws Error 查询失败。
 */
function scope(id: string) {
  return f.app
    .get(DatabaseService)
    .db.select()
    .from(runRetryItems)
    .where(eq(runRetryItems.runId, id))
    .all();
}

/** 只重试失败文件及必要父链，成功项和extras不加入；遵循refresh=false。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('replans only selected paths, keeps extras and avoids unrelated source subtrees', async () => {
  f.files.set('/source/nested', null);
  f.files.set('/source/nested/empty', Buffer.alloc(0));
  f.files.set('/source/unrelated', null);
  f.files.set('/source/unrelated/other', Buffer.from('other'));
  f.files.set('/target/extra', Buffer.from('keep'));
  const parent = await history({
    targets: [
      {
        instanceId: f.id,
        path: '/target',
        mode: 'mirror',
        deleteLimits: { enabled: false },
      },
    ],
  });
  const db = f.app.get(DatabaseService).db;
  db.update(operations)
    .set({ status: 'succeeded' })
    .where(eq(operations.runId, parent.id))
    .run();
  db.update(operations)
    .set({ status: 'unknown', unknownSince: Date.now() })
    .where(
      and(
        eq(operations.runId, parent.id),
        eq(operations.targetPath, '/target/nested/empty'),
      ),
    )
    .run();
  db.update(operations)
    .set({ status: 'failed' })
    .where(and(eq(operations.runId, parent.id), eq(operations.reason, 'extra')))
    .run();
  expect(f.runs().get(parent.id).retryEligibility).toMatchObject({
    eligible: true,
    candidateFiles: 1,
    candidateDirectories: 0,
  });
  const begin = f.server.calls.length;
  const accepted = f.runs().retry(parent.id, { confirmDeletes: false });
  const run = await terminal(f, accepted.id);
  expect(run).toMatchObject({
    status: 'succeeded',
    trigger: 'manual',
    retryOfRunId: parent.id,
    retrySourceExists: true,
  });
  expect(run.stats).toMatchObject({
    sourceFiles: 1,
    sourceDirectories: 1,
    plannedCreates: 1,
    plannedExtraDeletes: 0,
  });
  expect(f.files.get('/target/nested/empty')).toEqual(Buffer.alloc(0));
  expect(f.files.get('/target/extra')).toEqual(Buffer.from('keep'));
  expect(plan(f, run.id).map((op) => op.targetPath)).toEqual([
    '/target/nested',
    '/target/nested/empty',
  ]);
  const lists = f.server.calls
    .slice(begin)
    .filter((call) => call.url === '/api/fs/list')
    .map((call) => object(call.json));
  expect(lists.some((call) => call.path === '/source/unrelated')).toBe(false);
  expect(lists.filter((call) => call.path === '/source/nested')).toHaveLength(
    1,
  );
  expect(
    lists
      .filter(
        (call) => call.path === '/source' || call.path === '/source/nested',
      )
      .every((call) => call.refresh === false),
  ).toBe(true);
  expect(scope(run.id)).toMatchObject([
    { relativePath: 'nested/empty', scanOutcome: 'planned' },
  ]);
  expect(f.runs().get(run.id).retryEligibility.reason).toBe('NO_RETRY_ITEMS');
});

/** 双边缺名、缺失祖先和新过滤都必须收敛输入，不能触发全树空源判断。
 * @param mode 本轮变化。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it.each(['missing', 'ancestor', 'filtered'] as const)(
  'settles %s inputs without EMPTY_SOURCE or unnecessary mkdir',
  async (mode) => {
    f.files.delete('/source/new.txt');
    f.files.set('/source/dir', null);
    f.files.set('/source/dir/file', Buffer.from('data'));
    const parent = await history({ syncEmptyDirs: true });
    f.files.delete('/source/dir/file');
    if (mode === 'ancestor') f.files.delete('/source/dir');
    if (mode === 'filtered')
      f.jobs().patch(parent.job.id, { filters: { exclude: ['dir/'] } });
    const run = await terminal(
      f,
      f.runs().retry(parent.id, { confirmDeletes: false }).id,
    );
    expect(run.status).toBe('succeeded');
    expect(run.targets[0].blockReasons).not.toContain('EMPTY_SOURCE');
    expect(
      scope(run.id).every((item) => item.scanOutcome !== 'unprocessed'),
    ).toBe(true);
    if (mode !== 'missing') expect(plan(f, run.id)).toHaveLength(0);
    if (mode === 'ancestor') expect(run.stats.unchangedFiles).toBe(1);
  },
);

/** 选中项之外的兄弟仍参与碰撞判断，blocked范围可再次重试。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('blocks collisions with out-of-scope siblings and retries blocked inputs later', async () => {
  const parent = await history();
  f.files.set('/source/NEW.TXT', Buffer.from('conflict'));
  const blocked = await terminal(
    f,
    f.runs().retry(parent.id, { confirmDeletes: false }).id,
  );
  expect(blocked.status).toBe('partial');
  expect(blocked.targets[0].blockReasons).toContain('NAME_COLLISION');
  expect(scope(blocked.id)).toMatchObject([{ scanOutcome: 'blocked' }]);
  expect(blocked.stats.sourceFiles).toBe(1);
  f.files.delete('/source/NEW.TXT');
  const done = await terminal(
    f,
    f.runs().retry(blocked.id, { confirmDeletes: false }).id,
  );
  expect(done.status).toBe('succeeded');
});

/** 替换只用范围内D；无关同大小兄弟不能扩大预算，显式覆盖只放开数值限制。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('uses scoped deletion budgets and allows an explicit numeric override', async () => {
  f.files.set('/target/new.txt', Buffer.from('old'));
  for (let i = 0; i < 10; i++) {
    f.files.set(`/source/equal${i}`, Buffer.from('same'));
    f.files.set(`/target/equal${i}`, Buffer.from('same'));
  }
  const parent = await history({
    targets: [
      {
        instanceId: f.id,
        path: '/target',
        deleteLimits: { enabled: true, maxCount: 100, maxPercent: 10 },
      },
    ],
  });
  expect(f.runs().get(parent.id).retryEligibility.candidateFiles).toBe(1);
  const blocked = await terminal(
    f,
    f.runs().retry(parent.id, { confirmDeletes: false }).id,
  );
  expect(blocked.targets[0]).toMatchObject({
    observedTargetFileCount: 1,
    plannedReplaceCount: 1,
    deleteBudgetCount: 0,
  });
  expect(blocked.stats).toMatchObject({
    sourceFiles: 1,
    targetFiles: 1,
    unchangedFiles: 0,
  });
  expect(
    plan(f, blocked.id).every((op) => op.error?.code === 'DELETE_LIMIT'),
  ).toBe(true);
  expect(f.files.get('/target/new.txt')).toEqual(Buffer.from('old'));
  const done = await terminal(
    f,
    f.runs().retry(blocked.id, { confirmDeletes: true }).id,
  );
  expect(done.status).toBe('succeeded');
  expect(f.files.get('/target/new.txt')).toEqual(
    f.files.get('/source/new.txt'),
  );
});

/** 已成功的最后attempt、维护和清理记录不能使文件再次入选。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('collapses attempts and ignores maintenance and cleanup intents', async () => {
  const parent = await history();
  const db = f.app.get(DatabaseService).db;
  const original = db
    .select()
    .from(operations)
    .where(eq(operations.runId, parent.id))
    .get()!;
  db.insert(operations)
    .values({
      ...original,
      id: randomUUID(),
      seq: 2,
      retryOf: original.id,
      attemptNo: 2,
      status: 'succeeded',
    })
    .run();
  db.insert(operations)
    .values({
      ...original,
      id: randomUUID(),
      seq: 3,
      errorCode: 'REMOTE_TASK_CHANGED',
    })
    .run();
  db.insert(operations)
    .values({
      ...original,
      id: randomUUID(),
      seq: 4,
      action: 'delete',
      method: 'remove',
      reason: 'retry_cleanup',
      sourcePath: null,
      sourceInstanceId: null,
      expectedSourceSize: null,
    })
    .run();
  expect(f.runs().get(parent.id).retryEligibility).toMatchObject({
    eligible: false,
    reason: 'NO_RETRY_ITEMS',
  });
});

/** 只写下replace delete的中断计划仍代表文件意图。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('recovers a half-written replacement intent', async () => {
  f.files.set('/target/new.txt', Buffer.from('old'));
  const parent = await history();
  const db = f.app.get(DatabaseService).db;
  // 模拟PlanWriter刚提交delete批次，下一批create尚未写入。
  db.run(
    sql`DELETE FROM operation_dependencies WHERE operation_id IN (SELECT id FROM operations WHERE run_id=${parent.id} AND action='create')`,
  );
  db.run(
    sql`DELETE FROM operations WHERE run_id=${parent.id} AND action='create'`,
  );
  expect(f.runs().get(parent.id).retryEligibility.candidateFiles).toBe(1);
  const done = await terminal(
    f,
    f.runs().retry(parent.id, { confirmDeletes: true }).id,
  );
  expect(done.status).toBe('succeeded');
});

/** 未开始扫描就取消不能丢失输入；父历史清理后仍可执行子Run自己的范围。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('preserves queued leftovers and survives parent retention cleanup', async () => {
  const parent = await history();
  const accepted = f.runs().retry(parent.id, { confirmDeletes: false });
  f.runs().cancel(accepted.id);
  expect(scope(accepted.id)).toMatchObject([{ scanOutcome: 'unprocessed' }]);
  expect(f.runs().get(parent.id).retryEligibility.reason).toBe(
    'RUN_SUPERSEDED',
  );
  const next = f.runs().retry(accepted.id, { confirmDeletes: false });
  const db = f.app.get(DatabaseService).db;
  db.update(runs).set({ endedAt: 1 }).where(eq(runs.id, accepted.id)).run();
  await f.app.get(HistoryRetention).cycle();
  const done = await terminal(f, next.id);
  expect(done).toMatchObject({
    status: 'succeeded',
    retryOfRunId: accepted.id,
    retrySourceExists: false,
  });
  expect(scope(accepted.id)).toEqual([]);
  expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
});

/** 同一Target ID改变根时排除，新增目标不加入；源根变化拒绝。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('uses current configuration only for matching targets and rejects changed sources', async () => {
  f.files.set('/target2', null);
  const parent = await history({
    targets: [
      { instanceId: f.id, path: '/target' },
      { instanceId: f.id, path: '/target2' },
    ],
  });
  const [first, second] = parent.job.targets;
  f.jobs().patch(parent.job.id, {
    targets: [
      { id: first.id, concurrentFiles: 3 },
      { id: second.id, path: '/moved' },
      { instanceId: f.id, path: '/new-target' },
    ],
  });
  expect(f.runs().get(parent.id).retryEligibility).toMatchObject({
    candidateFiles: 1,
    excludedItems: 1,
  });
  const run = await terminal(
    f,
    f.runs().retry(parent.id, { confirmDeletes: false }).id,
  );
  expect(run.config.job.targets).toHaveLength(1);
  expect(run.config.job.targets[0]).toMatchObject({
    id: first.id,
    concurrentFiles: 3,
  });
  // 成功项不再重试，但源身份检查先于候选检查。
  f.jobs().patch(parent.job.id, { source: { path: '/changed' } });
  expect(f.runs().get(run.id).retryEligibility.reason).toBe(
    'SOURCE_ENDPOINT_CHANGED',
  );
  expect(() => f.runs().retry(run.id, { confirmDeletes: false })).toThrow(
    'Run cannot be retried',
  );
});

/** 扫描中断不执行部分计划；重启后未处理项仍可重试。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('retains unprocessed scope when scanning is interrupted by restart', async () => {
  const parent = await history();
  const entered = latch();
  const release = latch();
  f.fault = async (call, response) => {
    if (call.url === '/api/fs/list' && object(call.json).path === '/source') {
      entered.release();
      await release.promise;
    }
    return response;
  };
  const accepted = f.runs().retry(parent.id, { confirmDeletes: false });
  await entered.promise;
  await f.app.close();
  release.release();
  f.fault = undefined;
  await f.restart();
  expect(f.runs().get(accepted.id).status).toBe('interrupted');
  expect(scope(accepted.id)).toMatchObject([{ scanOutcome: 'unprocessed' }]);
  expect(
    (
      await terminal(
        f,
        f.runs().retry(accepted.id, { confirmDeletes: false }).id,
      )
    ).status,
  ).toBe('succeeded');
});

/** 超期历史可能已删去部分操作，必须拒绝而非提取剩余子集。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('rejects expired history and leaves ordinary dry runs ineligible', async () => {
  const parent = await history();
  f.app
    .get(DatabaseService)
    .db.update(runs)
    .set({ endedAt: 1 })
    .where(eq(runs.id, parent.id))
    .run();
  expect(f.runs().get(parent.id).retryEligibility.reason).toBe(
    'HISTORY_EXPIRED',
  );
  const dry = await preview(f, parent.job);
  expect(f.runs().get(dry.id).retryEligibility.reason).toBe('DRY_RUN');
});

/** 失败文件全部消失时，syncEmptyDirs也不能创建不在范围里的根或祖先。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('does not create missing target ancestors when all selected files vanished', async () => {
  f.files.delete('/source/new.txt');
  f.files.set('/source/dir', null);
  f.files.set('/source/dir/file', Buffer.from('data'));
  const parent = await history({ syncEmptyDirs: true });
  const db = f.app.get(DatabaseService).db;
  db.update(operations)
    .set({ status: 'succeeded' })
    .where(and(eq(operations.runId, parent.id), eq(operations.action, 'mkdir')))
    .run();
  f.files.delete('/source/dir/file');
  f.files.delete('/target');
  const run = await terminal(
    f,
    f.runs().retry(parent.id, { confirmDeletes: false }).id,
  );
  expect(run.status).toBe('succeeded');
  expect(plan(f, run.id)).toHaveLength(0);
  expect(run.stats).toMatchObject({ sourceFiles: 0, unchangedFiles: 1 });
  expect(f.files.has('/target')).toBe(false);
  expect(scope(run.id)).toMatchObject([{ scanOutcome: 'noop' }]);
});

/** 目录自身重试不能发现并复制它后来增加的文件。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('retries an explicit directory without expanding its contents', async () => {
  f.files.delete('/source/new.txt');
  f.files.set('/source/empty', null);
  const parent = await history({ syncEmptyDirs: true });
  f.files.set('/source/empty/later', Buffer.from('not selected'));
  const run = await terminal(
    f,
    f.runs().retry(parent.id, { confirmDeletes: false }).id,
  );
  expect(run.status).toBe('succeeded');
  expect(plan(f, run.id).map((op) => [op.action, op.targetPath])).toEqual([
    ['mkdir', '/target/empty'],
  ]);
  expect(run.stats.sourceFiles).toBe(0);
  expect(f.files.has('/target/empty/later')).toBe(false);
});

/** 文件变成目录不能借重试入口扩展为整棵子树。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('blocks source type changes without expanding the retry scope', async () => {
  const parent = await history();
  f.files.set('/source/new.txt', null);
  f.files.set('/source/new.txt/child', Buffer.from('later'));
  const run = await terminal(
    f,
    f.runs().retry(parent.id, { confirmDeletes: true }).id,
  );
  expect(run.status).toBe('partial');
  expect(run.targets[0].blockReasons).toContain('RETRY_TYPE_CHANGED');
  expect(plan(f, run.id)).toHaveLength(0);
  expect(scope(run.id)).toMatchObject([{ scanOutcome: 'blocked' }]);
});

/** 源范围不完整仍阻断所有删除，显式数值覆盖不能绕过保护。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('keeps hard deletion protections when a selected source subtree is unreadable', async () => {
  f.files.set('/target/new.txt', Buffer.from('old'));
  f.files.set('/source/broken', null);
  f.files.set('/source/broken/file', Buffer.from('data'));
  const parent = await history();
  f.fault = (call, response) =>
    call.url === '/api/fs/list' && object(call.json).path === '/source/broken'
      ? { body: { code: 500, message: 'unreadable', data: null } }
      : response;
  const run = await terminal(
    f,
    f.runs().retry(parent.id, { confirmDeletes: true }).id,
  );
  expect(run.status).toBe('partial');
  expect(run.targets[0]).toMatchObject({
    sourceComplete: false,
    deleteBlocked: true,
  });
  expect(
    plan(f, run.id)
      .filter((op) => op.reason === 'replace')
      .every((op) => op.status === 'skipped'),
  ).toBe(true);
  expect(f.files.get('/target/new.txt')).toEqual(Buffer.from('old'));
  expect(
    scope(run.id).find((item) => item.relativePath === 'broken/file')
      ?.scanOutcome,
  ).toBe('blocked');
});

/** 过滤前先比较完整父列表，不能把与目标兄弟碰撞的输入提前记noop。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('preserves collision precedence over filters in scoped decisions', async () => {
  const parent = await history();
  f.files.set('/target/NEW.TXT', Buffer.from('collision'));
  f.jobs().patch(parent.job.id, { filters: { exclude: ['new.txt'] } });
  const run = await terminal(
    f,
    f.runs().retry(parent.id, { confirmDeletes: false }).id,
  );
  expect(run.targets[0].blockReasons).toContain('NAME_COLLISION');
  expect(scope(run.id)).toMatchObject([{ scanOutcome: 'blocked' }]);
});

/** 范围替换占完预算后，文件自动重试不能免费删除残留。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('charges retry cleanup against the scoped replacement budget', async () => {
  f.files.set('/target/new.txt', Buffer.from('old'));
  const parent = await history({
    retryCount: 1,
    targets: [
      {
        instanceId: f.id,
        path: '/target',
        deleteLimits: { enabled: true, maxCount: 1, maxPercent: 100 },
      },
    ],
  });
  f.fault = (call, response) =>
    call.url.endsWith('/chunk')
      ? {
          body: {
            code: 500,
            message: 'retryable',
            data: {
              ...object(object(response.body).data),
              state: 'failed_retriable',
            },
          },
        }
      : response;
  const begin = f.server.calls.length;
  const run = await terminal(
    f,
    f.runs().retry(parent.id, { confirmDeletes: false }).id,
  );
  expect(run.targets[0]).toMatchObject({
    observedTargetFileCount: 1,
    plannedReplaceCount: 1,
    deleteBudgetCount: 1,
  });
  expect(plan(f, run.id).some((op) => op.error?.code === 'DELETE_LIMIT')).toBe(
    true,
  );
  expect(
    f.server.calls.slice(begin).filter((call) => call.url === '/api/fs/remove'),
  ).toHaveLength(1);
  expect(
    f.server.calls.slice(begin).filter((call) => call.url.endsWith('/init')),
  ).toHaveLength(1);
});

/** 同一源路径只为失败的Target重试，另一个Target的成功不被重新执行。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('keeps target-specific scope and counts source files only once', async () => {
  f.files.set('/target2', null);
  f.files.set('/source/second', Buffer.from('two'));
  const parent = await history({
    targets: [
      { instanceId: f.id, path: '/target' },
      { instanceId: f.id, path: '/target2' },
    ],
  });
  const db = f.app.get(DatabaseService).db;
  db.update(operations)
    .set({ status: 'succeeded' })
    .where(
      and(
        eq(operations.runId, parent.id),
        eq(operations.targetPath, '/target/second'),
      ),
    )
    .run();
  const run = await terminal(
    f,
    f.runs().retry(parent.id, { confirmDeletes: false }).id,
  );
  expect(run.status).toBe('succeeded');
  expect(run.stats).toMatchObject({ sourceFiles: 2, succeededCreates: 3 });
  expect(
    plan(f, run.id)
      .map((op) => op.targetPath)
      .sort(),
  ).toEqual(['/target/new.txt', '/target2/new.txt', '/target2/second']);
});

/** 排队重启从SQLite恢复独立范围，不依赖原内存队列或父计划。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('restores a queued retry with its original scope and queue deadline', async () => {
  await f.close();
  f = await relayFixture({ GLOBAL_MAX_RUNS: '1' });
  const parent = await history();
  f.files.set('/busy-source', null);
  f.files.set('/busy-target', null);
  const entered = latch();
  const release = latch();
  f.fault = async (call, response) => {
    if (
      call.url === '/api/fs/list' &&
      object(call.json).path === '/busy-source'
    ) {
      entered.release();
      await release.promise;
    }
    return response;
  };
  const blocker = f.job({
    source: { instanceId: f.id, path: '/busy-source' },
    targets: [{ instanceId: f.id, path: '/busy-target' }],
  });
  f.runs().trigger(blocker.id, { dryRun: true, confirmDeletes: false });
  await entered.promise;
  const accepted = f.runs().retry(parent.id, { confirmDeletes: false });
  expect(f.runs().get(accepted.id).status).toBe('queued');
  await f.app.close();
  release.release();
  f.fault = undefined;
  await f.restart();
  const done = await terminal(f, accepted.id);
  expect(done).toMatchObject({
    status: 'succeeded',
    retryOfRunId: parent.id,
    createdAt: accepted.createdAt,
    queueDeadlineAt: accepted.queueDeadlineAt,
  });
  expect(scope(done.id)).toMatchObject([
    { relativePath: 'new.txt', scanOutcome: 'planned' },
  ]);
});

/** 重试读取保持端点refresh配置，目标根缺失的父列表证明仍固定false。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('honors refresh=true while keeping the target-root parent proof unrefreshed', async () => {
  const parent = await history({
    source: { instanceId: f.id, path: '/source', refresh: true },
    targets: [{ instanceId: f.id, path: '/target', refresh: true }],
  });
  f.files.delete('/target');
  const begin = f.server.calls.length;
  const done = await terminal(
    f,
    f.runs().retry(parent.id, { confirmDeletes: false }).id,
  );
  expect(done.status).toBe('succeeded');
  const lists = f.server.calls
    .slice(begin)
    .filter((call) => call.url === '/api/fs/list')
    .map((call) => object(call.json));
  expect(
    lists.some((call) => call.path === '/source' && call.refresh === true),
  ).toBe(true);
  expect(
    lists.some((call) => call.path === '/' && call.refresh === false),
  ).toBe(true);
});

/** 同大小目标是本轮noop，后续重试不会因旧失败历史再次选中。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('drops equal-size no-op items from subsequent retry candidates', async () => {
  const parent = await history();
  f.files.set('/target/new.txt', Buffer.from('hello relay!'));
  const done = await terminal(
    f,
    f.runs().retry(parent.id, { confirmDeletes: false }).id,
  );
  expect(done.stats).toMatchObject({
    unchangedFiles: 1,
    sourceFiles: 1,
    targetFiles: 1,
    plannedCreates: 0,
  });
  expect(scope(done.id)).toMatchObject([{ scanOutcome: 'noop' }]);
  expect(done.retryEligibility.reason).toBe('NO_RETRY_ITEMS');
});
