// 固定cron库DST、搜索范围及动态注册触发行为，不把回调迟到当作错过。
import { SchedulerRegistry } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../src/database/database.service.js';
import { jobs } from '../src/database/job-schema.js';
import {
  nextFireTimes,
  validateSchedule,
} from '../src/scheduling/cron-time.js';
import { copyFixture } from './copy-fixture.js';
import type { CopyFixture } from './copy-fixture.js';
import { terminal } from './m2-fixture.js';
import { Readiness } from '../src/coordination/readiness.js';

/** 注册cron库行为与真实服务集成。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M4 scheduling', () => {
  /** 使用固定2026时钟锁定库八年搜索范围和Berlin DST。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('uses pinned DST behavior and returns a sparse prefix', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      expect(
        nextFireTimes(
          '30 2 * * *',
          'Europe/Berlin',
          3,
          new Date('2026-03-28T00:00:00Z'),
        ),
      ).toEqual([
        '2026-03-28T01:30:00.000Z',
        '2026-03-29T01:00:00.000Z',
        '2026-03-30T00:30:00.000Z',
      ]);
      expect(
        nextFireTimes(
          '30 2 * * *',
          'Europe/Berlin',
          3,
          new Date('2026-10-24T00:00:00Z'),
        ),
      ).toEqual([
        '2026-10-24T00:30:00.000Z',
        '2026-10-25T00:30:00.000Z',
        '2026-10-26T01:30:00.000Z',
      ]);
      expect(nextFireTimes('0 0 29 2 *', 'UTC', 5)).toHaveLength(2);
      expect(
        /** 验证解析成功但没有下一日期的表达式也被拒绝。
         * @param 不适用。
         * @returns 不适用。
         * @throws ApiError INVALID_CRON。
         */
        () => validateSchedule('0 0 31 2 *', 'UTC'),
      ).toThrow('Cron has no valid next occurrence');
    } finally {
      vi.useRealTimers();
    }
  });
  /** 非法时区保持Job字段错误形状，语法错误与无下一时刻区分说明。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('keeps the job field error shape and distinguishes syntax errors', () => {
    expect(
      /** 非法时区。
       * @param 不适用。
       * @returns 不适用。
       * @throws ApiError VALIDATION_ERROR。
       */
      () => validateSchedule('* * * * *', 'UTC+8'),
    ).toThrow(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'timezone', reason: 'Invalid value' }],
      }),
    );
    expect(
      /** 字段越界属于语法错误。
       * @param 不适用。
       * @returns 不适用。
       * @throws ApiError INVALID_CRON。
       */
      () => validateSchedule('61 * * * *', 'UTC'),
    ).toThrow('Invalid cron expression');
  });
  let f: CopyFixture;
  /** 注册只在恢复完成的真实应用中存在。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('coalesces duplicate callbacks, keeps theoretical time, and rejects stale registrations', async () => {
    f = await copyFixture();
    try {
      const job = f.job({
        createMode: 'server_copy',
        enabled: true,
        cron: '0 0 1 1 *',
      });
      const registry = f.app.get(SchedulerRegistry);
      const cron = registry.getCronJob(job.id);
      const expected = cron.nextDate().toJSDate().toISOString();
      const first = cron.fireOnTick();
      const second = cron.fireOnTick();
      await Promise.all([first, second]);
      const accepted = f.runs().list({ page: 1, pageSize: 50 }).items;
      expect(accepted).toHaveLength(1);
      expect(accepted[0]).toMatchObject({
        trigger: 'cron',
        scheduledAt: expected,
      });
      await terminal(f, accepted[0].id);
      f.jobs().setEnabled(job.id, false);
      await cron.fireOnTick();
      expect(f.runs().list({ page: 1, pageSize: 50 }).total).toBe(1);
      expect(f.jobs().nextFireTimes(job.id, 5).times).toEqual([]);
      f.jobs().setEnabled(job.id, true);
      expect(registry.getCronJob(job.id)).not.toBe(cron);
      f.app.get(Readiness).beginShutdown();
      expect(registry.getCronJob(job.id).isActive).toBe(false);
    } finally {
      await f.close();
    }
  });
  /** 重启只重建注册，不接受启动Run，manual-only不注册。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('does not catch up on restart and preserves narrow enable updates', async () => {
    f = await copyFixture();
    try {
      const job = f.job({ enabled: true, cron: null });
      f.jobs().patch(job.id, { cron: '0 0 1 1 *' });
      const manual = f.job({ enabled: true, cron: null });
      await f.restart();
      expect(f.runs().list({ page: 1, pageSize: 50 }).total).toBe(0);
      expect(f.app.get(SchedulerRegistry).getCronJobs().has(manual.id)).toBe(
        false,
      );
      const before = f.jobs().get(job.id);
      f.jobs().setEnabled(job.id, false);
      expect(f.jobs().get(job.id).targets).toEqual(before.targets);
      f.jobs().archive(job.id);
      expect(
        /** 归档Job不能通过next-fire接口重新暴露。
         * @param 不适用。
         * @returns 查询结果。
         * @throws ApiError 404。
         */
        () => f.jobs().nextFireTimes(job.id, 5),
      ).toThrow('Job not found');
    } finally {
      await f.close();
    }
  });
  /** 早期保存的无下一时刻表达式只跳过该Job，不能让每次启动都失败。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('skips a stored schedule without a next occurrence at startup', async () => {
    f = await copyFixture();
    try {
      const stale = f.job({ enabled: true, cron: null });
      const valid = f.job({ enabled: true, cron: '0 0 1 1 *' });
      f.app
        .get(DatabaseService)
        .db.update(jobs)
        .set({ cron: '0 0 31 2 *' })
        .where(eq(jobs.id, stale.id))
        .run();
      await f.restart();
      const registered = f.app.get(SchedulerRegistry).getCronJobs();
      expect(registered.has(stale.id)).toBe(false);
      expect(registered.has(valid.id)).toBe(true);
    } finally {
      await f.close();
    }
  });
});
