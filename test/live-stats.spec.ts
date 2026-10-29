// 验证活动 Run 的 SQL 聚合与终态聚合一致，并测量大计划的轮询成本。
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../src/database/database.service.js';
import { operations } from '../src/database/operation-schema.js';
import { runs, runTargets } from '../src/database/run-schema.js';
import { liveRunResult, runResult, targetResult } from '../src/sync/results.js';
import { m2Fixture, preview } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { seedOperations, setOperation } from './operation-fixture.js';

describe('live run statistics', () => {
  let fixture: M2Fixture;

  afterEach(async () => {
    if (fixture) await fixture.close();
  });

  it('matches final aggregation for retries, bytes and deterministic reasons', async () => {
    fixture = await m2Fixture();
    const run = await preview(fixture, fixture.job());
    const db = fixture.app.get(DatabaseService).db;
    const target = db
      .select()
      .from(runTargets)
      .where(eq(runTargets.runId, run.id))
      .get();
    if (!target) throw new Error('Run target missing');
    const now = Date.now();
    const failedId = randomUUID();
    const retryId = randomUUID();
    seedOperations(db, [
      {
        id: failedId,
        runId: run.id,
        runTargetId: target.id,
        seq: 100,
        action: 'create',
        method: 'relay',
        reason: 'new',
        status: 'failed',
        sourceInstanceId: fixture.id,
        sourcePath: '/source/retry.txt',
        targetInstanceId: fixture.id,
        targetPath: '/target/retry.txt',
        isDir: false,
        expectedSourceSize: 7,
        expectedTargetSize: null,
        affectedFileCount: 1,
        affectedBytes: 7,
        attemptNo: 1,
        bytesDownloaded: 5,
        bytesTransferred: 3,
        errorCode: 'OPENLIST_ERROR',
        errorMessage: 'temporary',
        createdAt: now,
        updatedAt: now,
        endedAt: now,
      },
      {
        id: retryId,
        runId: run.id,
        runTargetId: target.id,
        seq: 101,
        action: 'create',
        method: 'relay',
        reason: 'new',
        status: 'succeeded',
        sourceInstanceId: fixture.id,
        sourcePath: '/source/retry.txt',
        targetInstanceId: fixture.id,
        targetPath: '/target/retry.txt',
        isDir: false,
        expectedSourceSize: 7,
        expectedTargetSize: null,
        affectedFileCount: 1,
        affectedBytes: 7,
        operationId: failedId,
        attemptNo: 2,
        bytesDownloaded: 7,
        bytesTransferred: 4,
        createdAt: now,
        updatedAt: now,
        endedAt: now,
      },
    ]);

    const row = db.select().from(runs).where(eq(runs.id, run.id)).get();
    if (!row) throw new Error('Run missing');
    const live = liveRunResult(db, row);
    const final = runResult(db, row);
    const finalTarget = targetResult(db, target).target;
    const liveTarget = live.targets.find((item) => item.id === target.id);
    expect(liveTarget?.stats).toEqual(finalTarget.stats);
    expect(live.stats).toEqual(final.stats);
    expect(liveTarget?.stats.retryAttempts).toBe(1);
    expect(liveTarget?.stats.downloadedBytes).toBe(12);
    expect(liveTarget?.stats.transferredBytes).toBe(7);
    expect(liveTarget?.blockReasons).toEqual(finalTarget.blockReasons);
    const prototype = db
      .select()
      .from(operations)
      .where(eq(operations.id, failedId))
      .get();
    if (!prototype) throw new Error('Missing attempt');
    let seq = 102;
    for (const status of [
      'pending',
      'submitting',
      'submitted',
      'running',
      'succeeded',
      'failed',
      'unknown',
      'cancelled',
      'skipped',
    ] as const) {
      for (const reason of ['replace', 'extra', 'retry_cleanup'] as const) {
        seedOperations(db, {
          ...prototype,
          id: randomUUID(),
          attemptNo: 1,
          seq: seq++,
          targetPath: `/target/${seq}`,
          action: 'delete',
          method: 'remove',
          reason,
          status,
          isDir: reason === 'extra',
          affectedBytes: 4,
          bytesDownloaded: 2,
          bytesTransferred: 3,
          errorCode:
            status === 'skipped'
              ? 'PRECONDITION_ALREADY_ABSENT'
              : status === 'failed'
                ? 'DELETE_NOT_EFFECTIVE'
                : null,
          unknownSince: status === 'unknown' ? now : null,
        });
      }
    }
    const mixed = liveRunResult(db, row);
    const mixedFinal = runResult(db, row);
    expect(mixed).toEqual({
      stats: mixedFinal.stats,
      targets: mixedFinal.targets,
    });
    // 同一数据库观察点下，列表与详情的重试、维护记录排除和字节口径必须一致。
    for (const status of [
      'planned',
      'executing',
      'cancelling',
      'recovering',
    ] as const) {
      db.update(runs)
        .set({ status, dryRun: false, endedAt: null })
        .where(eq(runs.id, row.id))
        .run();
      const listed = fixture
        .runs()
        .list({ page: 1, pageSize: 20, status: 'active' });
      expect(listed.items[0].stats).toEqual(mixed.stats);
      expect(listed.items[0].stats).toEqual(fixture.runs().get(row.id).stats);
      expect(listed.items[0].jobName).toBe(row.config.job.name);
    }
    setOperation(db, eq(operations.id, failedId), {
      bytesTransferred: Number.MAX_SAFE_INTEGER,
    });
    expect(() => liveRunResult(db, row)).toThrow('RESOURCE_LIMIT');
    db.update(runs)
      .set({ status: 'executing', endedAt: null })
      .where(eq(runs.id, row.id))
      .run();
    expect(() => fixture.runs().get(row.id)).toThrow(
      'Run statistics exceed the safe integer range',
    );
    expect(() => fixture.runs().list({ page: 1, pageSize: 1 })).toThrow(
      expect.objectContaining({ code: 'RESOURCE_LIMIT' }),
    );
    // 不读取当前页之外的实时统计；Job列表同样不做实时聚合。
    expect(fixture.runs().list({ page: 2, pageSize: 1 })).toMatchObject({
      items: [],
      total: 1,
    });
    expect(
      fixture.jobs().list(1, 20, false).items[0].latestTerminalRealRun,
    ).toBeNull();
    // 查询溢出不改写执行状态或历史统计。
    expect(fixture.runs().record(row.id).status).toBe('executing');
    expect(fixture.runs().record(row.id).stats).toEqual(row.stats);
    for (const status of ['queued', 'scanning', 'succeeded'] as const) {
      db.update(runs)
        .set({ status, endedAt: status === 'succeeded' ? now : null })
        .where(eq(runs.id, row.id))
        .run();
      expect(
        fixture.runs().list({ page: 1, pageSize: 20 }).items[0].stats,
      ).toEqual(row.stats);
    }
    db.update(runs)
      .set({ status: 'succeeded', endedAt: now })
      .where(eq(runs.id, row.id))
      .run();
  });

  it('keeps p95 for twenty polls of a 100k-operation run below the poll budget', async () => {
    fixture = await m2Fixture();
    const run = await preview(fixture, fixture.job());
    const db = fixture.app.get(DatabaseService).db;
    const target = db
      .select()
      .from(runTargets)
      .where(eq(runTargets.runId, run.id))
      .get();
    if (!target) throw new Error('Run target missing');
    const now = Date.now();
    db.run(sql`
      WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n < 100000)
      INSERT INTO operations (id, run_id, run_target_id, seq, action, method, reason,
        status, target_instance_id, target_path, is_dir, affected_file_count,
        affected_bytes, created_at, updated_at, ended_at)
      SELECT 'perf-' || n, ${run.id}, ${target.id}, n+1000, 'delete', 'remove',
        'extra', 'succeeded', ${fixture.id}, '/target/perf-' || n, 0, 1, 1,
        ${now}, ${now}, ${now} FROM numbers
    `);
    db.run(sql`INSERT INTO operation_attempts (id,operation_id,target_instance_id,method,status,created_at,updated_at,ended_at)
      SELECT id,id,target_instance_id,method,status,created_at,updated_at,ended_at FROM operations WHERE run_id=${run.id} AND seq>=1000`);
    const row = db.select().from(runs).where(eq(runs.id, run.id)).get();
    if (!row) throw new Error('Run missing');
    const samples: number[] = [];
    const aggregateCalls = vi.spyOn(db, 'all');
    for (let attempt = 0; attempt < 20; attempt++) {
      const started = performance.now();
      const result = liveRunResult(db, row);
      samples.push(performance.now() - started);
      expect(result.stats.deletedAsExtra).toBe(100_000);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    console.info(
      `100k operations, 20 polls: p95=${p95.toFixed(1)}ms, max=${samples.at(-1)?.toFixed(1)}ms`,
    );
    const aggregate = aggregateCalls.mock.calls[0][0];
    aggregateCalls.mockRestore();
    console.info(
      'Aggregation query plan:',
      db.all(sql`EXPLAIN QUERY PLAN ${aggregate}`),
    );
    expect(p95).toBeLessThan(1000);
  }, 60_000);
});
