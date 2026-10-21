// 使用真实SQLite验证闭包资格、分批删除及cause CHECK不被放宽。
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { m2Fixture, preview, plan } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { DatabaseService } from '../src/database/database.service.js';
import {
  operations,
  operationDependencies,
} from '../src/database/operation-schema.js';
import { runs } from '../src/database/run-schema.js';
import { Readiness } from '../src/coordination/readiness.js';
import { HistoryRetention } from '../src/maintenance/history-retention.js';

/** 注册历史保留验收。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M5 history closure retention', () => {
  let f: M2Fixture;
  /** 创建一天保留的独立实例。
   * @param 不适用。
   * @returns 就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await m2Fixture({ RUN_RETENTION_DAYS: '1' });
  });
  /** 清理夹具。
   * @param 不适用。
   * @returns 退出。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    await f.close();
  });
  /** 旧Run引用新Run时整组保留；两者超期后pending dry-run计划可以删除。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('retains a mixed-age closure and removes it once every run expires', async () => {
    const old = await preview(f, f.job());
    const recent = await preview(f, f.job());
    const db = f.app.get(DatabaseService).db;
    db.update(runs)
      .set({ endedAt: Date.now() - 3 * 86400000 })
      .where(eq(runs.id, old.id))
      .run();
    db.update(operations)
      .set({ resolvedByRunId: recent.id })
      .where(eq(operations.id, plan(f, old.id)[0].id))
      .run();
    await f.app.get(HistoryRetention).cycle();
    expect(f.runs().list({ page: 1, pageSize: 50 }).total).toBe(2);
    db.update(runs)
      .set({ endedAt: Date.now() - 2 * 86400000 })
      .where(eq(runs.id, recent.id))
      .run();
    await f.app.get(HistoryRetention).cycle();
    expect(f.runs().list({ page: 1, pageSize: 50 }).total).toBe(0);
    expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
  });
  /** release不解决unknown，不能被保留期抹掉。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('keeps expired unresolved unknown even after quarantine release', async () => {
    const run = await preview(f, f.job());
    const db = f.app.get(DatabaseService).db;
    db.update(runs).set({ endedAt: 1 }).where(eq(runs.id, run.id)).run();
    db.update(operations)
      .set({
        status: 'unknown',
        endedAt: 1,
        unknownSince: 1,
        unknownUntil: 2,
        quarantineReleasedAt: 2,
      })
      .where(eq(operations.runId, run.id))
      .run();
    await f.app.get(HistoryRetention).cycle();
    expect(f.runs().get(run.id).id).toBe(run.id);
  });
  /** 大组分批让出事件循环，维护子记录先删以满足operations_cause。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('deletes bounded chunks including resolved maintenance children and dependencies', async () => {
    const run = await preview(f, f.job());
    const db = f.app.get(DatabaseService).db;
    const original = db
      .select()
      .from(operations)
      .where(eq(operations.runId, run.id))
      .get();
    if (!original) throw new Error('Missing fixture');
    db.transaction(
      /** 添加足够跨多批的纯历史子记录。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error SQL失败。
       */
      () => {
        for (let seq = 2; seq <= 700; seq++) {
          const id = randomUUID();
          db.insert(operations)
            .values({
              ...original,
              id,
              seq,
              method: 'server_copy',
              status: 'unknown',
              endedAt: 1,
              causedByOperationId: original.id,
              errorCode: 'REMOTE_TASK_CHANGED',
              unknownSince: 1,
              unknownUntil: 2,
              resolutionKind: 'abandoned',
              resolvedAt: 3,
              resolutionNote: 'Fixture resolved',
            })
            .run();
          db.insert(operationDependencies)
            .values({ operationId: id, dependsOnId: original.id })
            .run();
        }
        db.update(runs).set({ endedAt: 1 }).where(eq(runs.id, run.id)).run();
      },
    );
    let yielded = false;
    setImmediate(
      /** 证明清理在完成前允许事件循环执行其它回调。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      () => {
        yielded = true;
      },
    );
    await f.app.get(HistoryRetention).cycle();
    expect(yielded).toBe(true);
    expect(db.select().from(operations).all()).toHaveLength(0);
    expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    const query = db.all<{ detail: string }>(
      sql`EXPLAIN QUERY PLAN SELECT id FROM operations WHERE resolved_by_run_id=${run.id}`,
    );
    expect(JSON.stringify(query)).toContain('operations_resolved_run');
  });
  /** 未知引用导致RESTRICT时只保留该组，不关闭FK或把错误吞成成功。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('rolls back a restricted chunk and keeps foreign keys enabled', async () => {
    const run = await preview(f, f.job());
    const db = f.app.get(DatabaseService).db;
    db.update(runs).set({ endedAt: 1 }).where(eq(runs.id, run.id)).run();
    db.run(
      sql`CREATE TABLE retention_fixture (run_id TEXT REFERENCES runs(id) ON DELETE RESTRICT)`,
    );
    db.run(sql`INSERT INTO retention_fixture VALUES (${run.id})`);
    await f.app.get(HistoryRetention).cycle();
    expect(f.runs().record(run.id).id).toBe(run.id);
    expect(
      db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)?.foreign_keys,
    ).toBe(1);
    expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
  });
  /** 清理中途停止允许部分历史，重启后无需删除账本即可接续。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('continues partially deleted expired history after restart', async () => {
    const run = await preview(f, f.job());
    const db = f.app.get(DatabaseService).db;
    const original = db
      .select()
      .from(operations)
      .where(eq(operations.runId, run.id))
      .get();
    if (!original) throw new Error('Missing fixture');
    for (let seq = 2; seq <= 700; seq++)
      db.insert(operations)
        .values({ ...original, id: randomUUID(), seq })
        .run();
    db.update(runs).set({ endedAt: 1 }).where(eq(runs.id, run.id)).run();
    let observed = 700;
    /** 在实际批次已提交后停止，测试可见的部分历史而非私有方法。
     * @param 不适用。
     * @returns 不适用。
     * @throws Error 查询失败。
     */
    const interrupt = (): void => {
      observed =
        db.get<{ n: number }>(
          sql`SELECT count(*) AS n FROM operations WHERE run_id=${run.id}`,
        )?.n ?? 0;
      if (observed < 700) f.app.get(Readiness).beginShutdown();
      else setImmediate(interrupt);
    };
    setImmediate(interrupt);
    await f.app.get(HistoryRetention).cycle();
    expect(observed).toBeGreaterThan(0);
    expect(observed).toBeLessThan(700);
    await f.restart();
    await f.app.get(HistoryRetention).cycle();
    expect(f.runs().list({ page: 1, pageSize: 50 }).total).toBe(0);
  });
});
