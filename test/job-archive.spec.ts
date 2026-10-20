// 验证归档 Job 保留最终成员集合，目标移出与 Job 归档在同一毫秒也不会混淆。
import { eq } from 'drizzle-orm';
import { m2Fixture, preview } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { DatabaseService } from '../src/database/database.service.js';
import { jobs, jobTargets } from '../src/database/schema.js';
import { InstancesService } from '../src/instances/instances.service.js';

/** 覆盖目标成员关系与 Job 归档状态分离后的归档视图、写入事实和后续拒绝。
 * @param 不适用。
 * @returns 不适用。
 * @throws Error 断言失败。
 */
describe('M2 archived Job membership', () => {
  let f: M2Fixture;
  afterEach(
    /** 恢复真实时钟并关闭本用例创建的夹具。
     * @param 不适用。
     * @returns 完成 Promise。
     * @throws Error 清理失败。
     */
    async () => {
      vi.useRealTimers();
      if (f) await f.close();
    },
  );
  /** 同一毫秒内多次移出、替换同一 position 后归档，归档视图只含最终成员，旧 Run 快照不变。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('keeps only the final members of an archived Job even within one millisecond', async () => {
    f = await m2Fixture();
    const job = f.job({
      targets: [
        { instanceId: f.id, path: '/a' },
        { instanceId: f.id, path: '/b' },
      ],
    });
    const [a, b] = job.targets;
    const before = await preview(f, job);
    vi.useFakeTimers({ toFake: ['Date'] });
    const instant = Date.parse('2026-10-20T04:00:00.000Z');
    vi.setSystemTime(instant);
    f.jobs().patch(job.id, { targets: [{ id: a.id }] });
    const c = f.jobs().patch(job.id, {
      targets: [{ instanceId: f.id, path: '/c' }],
    }).targets[0];
    const d = f.jobs().patch(job.id, {
      targets: [{ instanceId: f.id, path: '/d' }],
    }).targets[0];
    f.jobs().archive(job.id);
    vi.useRealTimers();

    const archived = f.jobs().list(1, 50, true).items;
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({
      id: job.id,
      archivedAt: new Date(instant).toISOString(),
      targets: [{ id: d.id, path: '/d', position: 0 }],
    });
    expect(archived[0].targets).toHaveLength(1);

    const db = f.app.get(DatabaseService).db;
    const rows = db
      .select({ id: jobTargets.id, archivedAt: jobTargets.archivedAt })
      .from(jobTargets)
      .where(eq(jobTargets.jobId, job.id))
      .all();
    expect(Object.fromEntries(rows.map(toEntry))).toEqual({
      [a.id]: instant,
      [b.id]: instant,
      [c.id]: instant,
      [d.id]: null,
    });
    expect(
      db
        .select({ archivedAt: jobs.archivedAt })
        .from(jobs)
        .where(eq(jobs.id, job.id))
        .get()?.archivedAt,
    ).toBe(instant);

    expect(
      /** 读取已归档 Job。
       * @param 不适用。
       * @returns 不适用。
       * @throws ApiError 预期的 Job not found。
       */
      () => f.jobs().get(job.id),
    ).toThrow('Job not found');
    expect(
      /** 修改已归档 Job。
       * @param 不适用。
       * @returns 不适用。
       * @throws ApiError 预期的 Job not found。
       */
      () => f.jobs().patch(job.id, { name: 'revived' }),
    ).toThrow('Job not found');
    expect(
      /** 触发已归档 Job 的预览。
       * @param 不适用。
       * @returns 不适用。
       * @throws ApiError 预期的 Job not found。
       */
      () => f.runs().trigger(job.id, { dryRun: true, confirmDeletes: false }),
    ).toThrow('Job not found');
    expect(f.runs().get(before.id).config.job.targets.map(toTargetId)).toEqual([
      a.id,
      b.id,
    ]);
    f.app.get(InstancesService).archive(f.id);
  });
});

/** 把目标行转换为便于整体断言的 [id, archivedAt] 对。
 * @param row 目标 ID 与移出时间。
 * @returns 二元组。
 * @throws 不适用。
 */
function toEntry(row: {
  id: string;
  archivedAt: number | null;
}): [string, number | null] {
  return [row.id, row.archivedAt];
}

/** 取出快照目标的稳定 ID。
 * @param target 快照中的目标。
 * @returns 目标 ID。
 * @throws 不适用。
 */
function toTargetId(target: { id: string }): string {
  return target.id;
}
