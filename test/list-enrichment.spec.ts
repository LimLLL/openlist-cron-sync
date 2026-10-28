// 验证真实SQLite上的列表筛选、分页、冻结名称与调度预览；不改写配置或快照。
import { eq } from 'drizzle-orm';
import { CronTime } from 'cron';
import { DatabaseService } from '../src/database/database.service.js';
import { jobs } from '../src/database/job-schema.js';
import { ACTIVE_RUN_STATUSES } from '../src/runs/run-types.js';
import { TERMINAL_RUNS } from '../src/runs/run-finalizer.js';
import { m2Fixture } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { seedListRun } from './list-fixture.js';

describe('read-only list enrichment', () => {
  let f: M2Fixture;
  /** 创建真实数据库和已验证端点。
   * @returns 初始化完成。
   * @throws Error 夹具初始化失败。
   */
  beforeEach(async () => {
    f = await m2Fixture();
  });
  /** 恢复时钟并关闭本例资源。
   * @returns 清理完成。
   * @throws Error 资源关闭失败。
   */
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await f.close();
  });

  /** 预览及活动运行不替换已有真实终态，没有真实终态时显式返回null。
   * @returns 验证完成。
   * @throws Error 数据库或断言失败。
   */
  it('keeps real outcomes across previews and active runs, with explicit null cases', () => {
    const never = f.job();
    const previewOnly = f.job();
    seedListRun(f, previewOnly, { dryRun: true });
    const activeOnly = f.job();
    seedListRun(f, activeOnly, { status: 'queued' });
    const job = f.job();
    const failed = seedListRun(f, job, {
      status: 'failed',
      createdAt: 100,
      errorCode: 'QUEUE_TIMEOUT',
    });
    seedListRun(f, job, { dryRun: true, createdAt: 200 });
    seedListRun(f, job, { status: 'executing', createdAt: 300 });
    const page = f.jobs().list(1, 200, false);
    expect(page.total).toBe(4);
    for (const id of [never.id, previewOnly.id, activeOnly.id])
      expect(
        page.items.find((item) => item.id === id)?.latestTerminalRealRun,
      ).toBeNull();
    expect(
      page.items.find((item) => item.id === job.id)?.latestTerminalRealRun,
    ).toEqual({
      id: failed.id,
      status: 'failed',
      createdAt: new Date(100).toISOString(),
      startedAt: null,
      endedAt: new Date(101).toISOString(),
      stopReason: null,
      error: { code: 'QUEUE_TIMEOUT', message: 'QUEUE_TIMEOUT' },
    });
    expect(f.jobs().get(job.id)).toEqual(job);
    expect(f.runs().record(failed.id)).toEqual(failed);
  });

  /** 全部终态参与摘要，创建时间及ID决定最新项，endedAt不改变排序。
   * @returns 验证完成。
   * @throws Error 数据库或断言失败。
   */
  it('includes every terminal status and orders by creation time then ID', () => {
    for (const status of TERMINAL_RUNS) {
      const job = f.job();
      const run = seedListRun(f, job, { status });
      expect(
        f
          .jobs()
          .list(1, 200, false)
          .items.find((item) => item.id === job.id)?.latestTerminalRealRun,
      ).toMatchObject({ id: run.id, status });
    }
    const job = f.job();
    seedListRun(f, job, { status: 'failed', createdAt: 100, endedAt: 9999 });
    seedListRun(f, job, {
      id: '00000000-0000-4000-8000-000000000001',
      createdAt: 200,
    });
    const cancelled = seedListRun(f, job, {
      id: '00000000-0000-4000-8000-000000000002',
      createdAt: 200,
      status: 'cancelled',
      stopReason: 'USER_CANCEL',
    });
    expect(
      f
        .jobs()
        .list(1, 200, false)
        .items.find((item) => item.id === job.id)?.latestTerminalRealRun,
    ).toMatchObject({
      id: cancelled.id,
      status: 'cancelled',
      stopReason: 'USER_CANCEL',
    });
  });

  /** 多目标及多次运行不扩增分页行；归档只影响Job筛选而不清除摘要。
   * @returns 验证完成。
   * @throws Error 数据库或断言失败。
   */
  it('preserves job pagination, totals and archived summaries', () => {
    const db = f.app.get(DatabaseService).db;
    const older = f.job({
      targets: [
        { instanceId: f.id, path: '/target' },
        { instanceId: f.id, path: '/second' },
      ],
    });
    db.update(jobs).set({ createdAt: 100 }).where(eq(jobs.id, older.id)).run();
    seedListRun(f, older, { createdAt: 100 });
    const latest = seedListRun(f, older, { createdAt: 200 });
    const newer = f.job();
    db.update(jobs).set({ createdAt: 200 }).where(eq(jobs.id, newer.id)).run();
    expect(f.jobs().list(1, 1, false)).toMatchObject({
      total: 2,
      items: [{ id: newer.id }],
    });
    const second = f.jobs().list(2, 1, false);
    expect(second).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 2,
      items: [{ id: older.id, latestTerminalRealRun: { id: latest.id } }],
    });
    expect(second.items[0].targets).toHaveLength(2);
    expect(f.jobs().list(3, 1, false)).toEqual({
      items: [],
      total: 2,
      page: 3,
      pageSize: 1,
    });
    f.jobs().archive(older.id);
    expect(f.jobs().list(1, 200, false).total).toBe(1);
    expect(f.jobs().list(1, 200, true)).toMatchObject({
      total: 2,
      items: [
        { id: newer.id },
        {
          id: older.id,
          latestTerminalRealRun: { id: latest.id },
          nextFireAt: null,
          scheduleError: null,
        },
      ],
    });
  });

  /** 仅启用未归档cron产生预览，已知坏配置成为行内诊断。
   * @returns 验证完成。
   * @throws Error 数据库或断言失败。
   */
  it('reports schedule diagnostics without changing disabled, manual or archived jobs', () => {
    const db = f.app.get(DatabaseService).db;
    const cases = [
      { cron: '* * * * *', timezone: 'UTC', enabled: false, code: null },
      { cron: null, timezone: 'UTC', enabled: true, code: null },
      {
        cron: '* * * * *',
        timezone: 'UTC+8',
        enabled: true,
        code: 'INVALID_TIMEZONE',
      },
      {
        cron: '61 * * * *',
        timezone: 'UTC',
        enabled: true,
        code: 'INVALID_CRON',
      },
      {
        cron: '* * * * * *',
        timezone: 'UTC',
        enabled: true,
        code: 'INVALID_CRON',
      },
      {
        cron: '0 0 31 2 *',
        timezone: 'UTC',
        enabled: true,
        code: 'NO_NEXT_OCCURRENCE',
      },
    ];
    for (const testCase of cases) {
      const job = f.job();
      db.update(jobs)
        .set({
          cron: testCase.cron,
          timezone: testCase.timezone,
          enabled: testCase.enabled,
        })
        .where(eq(jobs.id, job.id))
        .run();
      const before = f.jobs().get(job.id);
      const item = f
        .jobs()
        .list(1, 200, false)
        .items.find((entry) => entry.id === job.id)!;
      expect(item.nextFireAt).toBeNull();
      expect(item.scheduleError?.code ?? null).toBe(testCase.code);
      expect(f.jobs().get(job.id)).toEqual(before);
      if (testCase.code !== null) {
        f.jobs().archive(job.id);
        expect(
          f
            .jobs()
            .list(1, 200, true)
            .items.find((entry) => entry.id === job.id),
        ).toMatchObject({ nextFireAt: null, scheduleError: null });
      }
    }
  });

  /** 分钟边界跨越期间同一响应仍以同一个起点计算；意外计算故障不能伪装成行内错误。
   * @returns 验证完成。
   * @throws Error 数据库或断言失败。
   */
  it('uses one reference instant per page and propagates unexpected schedule failures', () => {
    const db = f.app.get(DatabaseService).db;
    for (let index = 0; index < 2; index++) {
      const job = f.job();
      db.update(jobs)
        .set({ enabled: true, cron: '* * * * *' })
        .where(eq(jobs.id, job.id))
        .run();
    }
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:59.000Z'));
    const original = CronTime.prototype.getNextDateFrom;
    const calculation = vi
      .spyOn(CronTime.prototype, 'getNextDateFrom')
      .mockImplementation(function (this: CronTime, ...args) {
        vi.setSystemTime(new Date('2026-01-01T00:01:01.000Z'));
        return original.apply(this, args);
      });
    expect(
      f
        .jobs()
        .list(1, 200, false)
        .items.map((item) => item.nextFireAt),
    ).toEqual(['2026-01-01T00:01:00.000Z', '2026-01-01T00:01:00.000Z']);
    const unexpected = new Error('Unexpected cron failure');
    calculation.mockImplementation(() => {
      throw unexpected;
    });
    expect(() => f.jobs().list(1, 200, false)).toThrow(unexpected);
  });

  /** active筛选组合现有参数并在分页前应用，历史标签取快照名称。
   * @returns 验证完成。
   * @throws Error 数据库或断言失败。
   */
  it('filters all active statuses before pagination and freezes historical job names', () => {
    const active = ACTIVE_RUN_STATUSES.map((status, index) =>
      seedListRun(f, f.job(), {
        status,
        dryRun: index % 2 === 0,
        createdAt: 100 + index,
      }),
    );
    const job = f.job({ name: 'Frozen name' });
    const finished = seedListRun(f, job, { createdAt: 1000 });
    f.jobs().patch(job.id, { name: 'Renamed' });
    f.jobs().archive(job.id);
    expect(
      f.runs().list({ page: 1, pageSize: 200, jobId: job.id }).items[0],
    ).toMatchObject({ id: finished.id, jobName: 'Frozen name' });
    const result = f.runs().list({ page: 1, pageSize: 2, status: 'active' });
    expect(result.total).toBe(6);
    expect(result.items.map((run) => run.id)).toEqual([
      active[5].id,
      active[4].id,
    ]);
    const all = f.runs().list({ page: 1, pageSize: 200, status: 'active' });
    expect(new Set(all.items.map((run) => run.status))).toEqual(
      new Set(ACTIVE_RUN_STATUSES),
    );
    expect(
      f.runs().list({ page: 1, pageSize: 200, status: 'active', dryRun: true })
        .total,
    ).toBe(3);
    expect(
      f.runs().list({
        page: 1,
        pageSize: 200,
        status: 'active',
        jobId: active[1].jobId,
        dryRun: false,
      }),
    ).toMatchObject({
      total: 1,
      items: [{ id: active[1].id, status: 'scanning' }],
    });
    expect(f.runs().list({ page: 4, pageSize: 2, status: 'active' })).toEqual({
      items: [],
      total: 6,
      page: 4,
      pageSize: 2,
    });
  });
});
