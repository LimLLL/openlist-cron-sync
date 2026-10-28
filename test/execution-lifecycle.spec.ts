// 验证取消、重启和未知责任不会因生命周期切换丢失。
import { eq } from 'drizzle-orm';
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { terminal, plan, preview } from './m2-fixture.js';
import { latch } from './openlist-fixture.js';
import { DatabaseService } from '../src/database/database.service.js';
import { runs } from '../src/database/run-schema.js';
import { operations } from '../src/database/operation-schema.js';
import { PathOccupancy } from '../src/coordination/path-occupancy.js';

/** 注册执行生命周期行为。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M3 cancellation, recovery and historical unknown outcomes', () => {
  let f: RelayFixture;
  /** 每个场景有独立本地和远端状态。
   * @param 不适用。
   * @returns 夹具就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await relayFixture();
  });
  /** 关闭测试拥有的资源。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    await f.close();
  });
  /** 未确定complete时取消必须保留unknown，不能把abort当成功证明。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('cancels once, preserves unknown and releases the execution slot', async () => {
    const entered = latch();
    const release = latch();
    f.fault =
      /** 阻塞complete响应以在提交窗口内发起取消。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws 不适用。
       */
      async (call, response) => {
        if (call.url.endsWith('/complete')) {
          entered.release();
          await release.promise;
        }
        return response;
      };
    const job = f.job();
    const accepted = f
      .runs()
      .trigger(job.id, { dryRun: false, confirmDeletes: false });
    await entered.promise;
    f.runs().cancel(accepted.id);
    f.runs().cancel(accepted.id);
    try {
      const result = await terminal(f, accepted.id);
      expect(result.status).toBe('cancelled');
      expect(result.stopReason).toBe('USER_CANCEL');
      expect(result.stats.unknownOperations).toBe(1);
      expect(
        f.server.calls.filter(
          /** 识别取消触发的abort请求。
           * @param call 真实HTTP请求及其捕获头。
           * @returns 满足上述请求或操作条件时返回true。
           * @throws 不适用。
           */
          (call) => call.url.endsWith('/abort'),
        ),
      ).toHaveLength(1);
      expect(
        f.app
          .get(DatabaseService)
          .db.select()
          .from(runs)
          .where(eq(runs.id, accepted.id))
          .get()?.secretSnapshotEnc,
      ).toBeNull();
    } finally {
      release.release();
    }
  });
  /** SIGTERM关闭不写Run终态，下一次启动统一interrupted。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言或重启失败。
   */
  it('leaves an executing Run nonterminal at shutdown and interrupts it after restart', async () => {
    const entered = latch();
    const release = latch();
    f.fault =
      /** 阻塞complete响应以模拟关机时仍在途的写入。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws 不适用。
       */
      async (call, response) => {
        if (call.url.endsWith('/complete')) {
          entered.release();
          await release.promise;
        }
        return response;
      };
    const accepted = f
      .runs()
      .trigger(f.job().id, { dryRun: false, confirmDeletes: false });
    await entered.promise;
    const restarting = f.restart();
    release.release();
    await restarting;
    const result = await terminal(f, accepted.id);
    expect(result.status).toBe('interrupted');
    expect(result.stopReason).toBe('PROCESS_RESTART');
  });
  /** 提交前事务已提交但响应未保存，重启只能分类unknown。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言或数据库失败。
   */
  it('rebuilds submitting responsibility and never executes old pending operations', async () => {
    const result = await preview(f, f.job());
    const db = f.app.get(DatabaseService).db;
    db.update(runs)
      .set({ status: 'executing', dryRun: false, endedAt: null })
      .where(eq(runs.id, result.id))
      .run();
    db.update(operations)
      .set({ status: 'submitting', submittedAt: Date.now() })
      .where(eq(operations.runId, result.id))
      .run();
    await f.restart();
    const restored = await terminal(f, result.id);
    expect(restored.status).toBe('interrupted');
    const operation = plan(f, result.id)[0];
    expect(operation.status).toBe('unknown');
    expect(operation.unknownSince).not.toBeNull();
    expect(
      f.server.calls.some(
        /** 识别重启后不应出现的init请求。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) => call.url.endsWith('/init'),
      ),
    ).toBe(false);
    const since = operation.unknownSince;
    await f.restart();
    expect(plan(f, result.id)[0].unknownSince).toBe(since);
  });
  /** 已经recovering的Run沿用首次deadline，旧pending一律废弃。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('preserves the first recovery deadline and skips all old pending work', async () => {
    const result = await preview(f, f.job());
    const deadline = Date.now() - 1;
    f.app
      .get(DatabaseService)
      .db.update(runs)
      .set({
        status: 'recovering',
        dryRun: false,
        endedAt: null,
        recoveryDeadlineAt: deadline,
      })
      .where(eq(runs.id, result.id))
      .run();
    await f.restart();
    const restored = await terminal(f, result.id);
    expect(restored.recoveryDeadlineAt).toBe(new Date(deadline).toISOString());
    expect(plan(f, result.id)[0]).toMatchObject({
      status: 'skipped',
      error: { code: 'PLAN_INTERRUPTED' },
    });
  });
  /** dry-run只读占用阻止重叠写入，同时允许不同Job的只读预览。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('uses read claims for every preview endpoint and write claims for real targets', async () => {
    const result = await preview(f, f.job());
    const db = f.app.get(DatabaseService).db;
    const row = db.select().from(runs).where(eq(runs.id, result.id)).get();
    if (!row) throw new Error('Missing fixture run');
    const occupancy = f.app.get(PathOccupancy);
    expect(occupancy.acquire({ ...row, id: 'preview-a' })).toBe(true);
    expect(occupancy.acquire({ ...row, id: 'preview-b' })).toBe(true);
    expect(occupancy.acquire({ ...row, id: 'writer', dryRun: false })).toBe(
      false,
    );
    occupancy.release('preview-a');
    occupancy.release('preview-b');
    expect(occupancy.acquire({ ...row, id: 'writer', dryRun: false })).toBe(
      true,
    );
    occupancy.release('writer');
  });
  /** 同步失败的单个Target不取消独立目标。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('allows an independent Target to succeed when another fails', async () => {
    f.files.set('/second', null);
    f.fault =
      /** 仅让第一个Target的init失败以验证其它Target独立完成。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws 不适用。
       */
      (call, response) =>
        call.url.endsWith('/init') &&
        decodeURIComponent(String(call.headers['file-path'])).startsWith(
          '/target/',
        )
          ? envelopeFailure()
          : response;
    const job = f.job({
      targets: [
        { instanceId: f.id, path: '/target' },
        { instanceId: f.id, path: '/second' },
      ],
    });
    const result = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: false }).id,
    );
    expect(result.status).toBe('partial');
    expect(f.files.get('/second/new.txt')).toEqual(
      f.files.get('/source/new.txt'),
    );
  });
});
/** 构造明确拒绝，无原始上游消息。
 * @param 不适用。
 * @returns F1错误响应。
 * @throws 不适用。
 */
function envelopeFailure() {
  return { body: { code: 403, message: 'denied', data: null } };
}
