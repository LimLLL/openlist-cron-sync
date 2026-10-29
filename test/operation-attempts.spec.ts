// 真实SQLite验证逻辑身份、原子重试及公开摘要/历史契约。
import { eq, sql } from 'drizzle-orm';
import { m2Fixture, preview, directory, listing } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { file } from './openlist-fixture.js';
import { DatabaseService } from '../src/database/database.service.js';
import {
  operations,
  operationAttempts,
  operationDependencies,
} from '../src/database/operation-schema.js';
import { runs } from '../src/database/run-schema.js';
import { OperationStore } from '../src/sync/operation-store.js';
import { OperationsService } from '../src/runs/operations.service.js';
import { liveRunResult, runResult } from '../src/sync/results.js';

let fixture: M2Fixture;
afterEach(async () => {
  if (fixture) await fixture.close();
});

/** 创建带mkdir依赖的真实计划，转入执行阶段以检查Store写事务。
 * @returns 数据库、Store和根操作。
 * @throws Error 夹具或规划失败。
 */
async function setup() {
  fixture = await m2Fixture({ RETRY_MAX_ATTEMPTS: '3' });
  fixture.tree.set('/source', listing(directory('nested')));
  fixture.tree.set('/source/nested', listing(file('child')));
  const run = await preview(fixture, fixture.job());
  const db = fixture.app.get(DatabaseService).db;
  db.update(runs)
    .set({ status: 'executing', dryRun: false, endedAt: null })
    .where(eq(runs.id, run.id))
    .run();
  const record = fixture.runs().record(run.id);
  const root = db
    .select()
    .from(operations)
    .where(eq(operations.runId, run.id))
    .all()
    .find((op) => op.action === 'mkdir');
  if (!root) throw new Error('Expected mkdir dependency');
  return {
    db,
    record,
    root,
    store: new OperationStore(db, record),
    api: fixture.app.get(OperationsService),
  };
}

/** 失败与下一次pending必须一起可见，成功后只剩一条逻辑结果，旧URL仍可用。 */
it('keeps dependencies and canonical IDs stable across atomic retries', async () => {
  const { db, record, root, store, api } = await setup();
  const edges = db.select().from(operationDependencies).all();
  store.bytes(root.id, 7, 3);
  expect(
    store.end(
      root.id,
      {
        status: 'failed',
        code: 'OPENLIST_ERROR',
        message: 'Download HTTP 503',
      },
      true,
    ),
  ).toBe(true);
  const retry = store.current(root.id);
  expect(retry).toMatchObject({
    operationId: root.id,
    attemptNo: 2,
    status: 'pending',
    seq: root.seq,
  });
  expect(retry.nextAttemptAt).not.toBeNull();
  expect(api.get(root.id)).toMatchObject({
    id: root.id,
    status: 'pending',
    attemptCount: 2,
    endedAt: null,
    error: null,
  });
  expect(api.list({ page: 1, pageSize: 50, status: 'failed' }).total).toBe(0);
  expect(store.end(root.id, { status: 'succeeded' })).toBe(false);
  store.bytes(retry.id, 11, 8);
  store.end(retry.id, { status: 'succeeded' });
  const detail = api.get(retry.id);
  expect(detail).toMatchObject({
    id: root.id,
    status: 'succeeded',
    attemptCount: 2,
    bytesDownloaded: 18,
    bytesTransferred: 11,
    error: null,
  });
  expect(detail.attempts.map((attempt) => attempt.status)).toEqual([
    'failed',
    'succeeded',
  ]);
  expect(detail.attempts[0].error?.message).toBe('Download HTTP 503');
  expect(detail).not.toHaveProperty('retryOf');
  expect(detail).not.toHaveProperty('attemptNo');
  expect(detail).not.toHaveProperty('task');
  expect(api.list({ page: 1, pageSize: 50 }).items[0]).not.toHaveProperty(
    'attempts',
  );
  expect(db.select().from(operationDependencies).all()).toEqual(edges);
  expect(liveRunResult(db, record).stats).toEqual(runResult(db, record).stats);
  expect(liveRunResult(db, record).stats).toMatchObject({
    retryAttempts: 1,
    failedOperations: 0,
    downloadedBytes: 18,
    transferredBytes: 11,
  });
});

/** 新尝试插入失败不能留下已结束的父子记录或部分增加的计数。 */
it('rolls back the result and counter when scheduling a retry fails', async () => {
  const { db, root, store } = await setup();
  db.run(
    sql`CREATE TEMP TRIGGER fail_retry BEFORE INSERT ON operation_attempts WHEN NEW.attempt_no=2 BEGIN SELECT RAISE(ABORT,'fixture retry insertion failed'); END`,
  );
  expect(() =>
    store.end(root.id, { status: 'failed', code: 'OPENLIST_ERROR' }, true),
  ).toThrow();
  expect(store.current(root.id)).toMatchObject({
    status: 'pending',
    attemptCount: 1,
    endedAt: null,
    errorCode: null,
  });
  expect(
    db
      .select()
      .from(operationAttempts)
      .where(eq(operationAttempts.operationId, root.id))
      .all(),
  ).toHaveLength(1);
});

/** unknown和停止信号都不能安排重试；冻结预算耗尽后逻辑操作才failed。 */
it.each(['unknown', 'stopping', 'exhausted'] as const)(
  'settles %s without leaving another pending attempt',
  async (scenario) => {
    const { root, store, api } = await setup();
    if (scenario === 'unknown')
      store.end(root.id, { status: 'unknown', code: 'OPENLIST_ERROR' }, true);
    else if (scenario === 'stopping')
      store.end(root.id, { status: 'failed' }, true, AbortSignal.abort());
    else
      for (let attempt = 1; attempt <= 3; attempt++)
        store.end(store.current(root.id).id, { status: 'failed' }, true);
    expect(api.get(root.id)).toMatchObject({
      status: scenario === 'unknown' ? 'unknown' : 'failed',
      attemptCount: scenario === 'exhausted' ? 3 : 1,
    });
  },
);
