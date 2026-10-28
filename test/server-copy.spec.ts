// 验证copy真实工作流、源前提、已知task状态和取消恢复窗口。
import { eq } from 'drizzle-orm';
import { copyFixture } from './copy-fixture.js';
import type { CopyFixture } from './copy-fixture.js';
import { plan, terminal, preview, listing } from './m2-fixture.js';
import { envelope } from './openlist-fixture.js';
import { DatabaseService } from '../src/database/database.service.js';
import { operations } from '../src/database/operation-schema.js';
import { runs } from '../src/database/run-schema.js';
import { TaskResources } from '../src/coordination/task-resources.js';

/** 注册生产copy链路验收。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M6 server copy execution', () => {
  let f: CopyFixture;
  /** 建立独立F1。
   * @param 不适用。
   * @returns 就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await copyFixture();
  });
  /** 清理本例。
   * @param 不适用。
   * @returns 退出。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    await f.close();
  });
  /** 两类成功均完成同一替换依赖链。
   * @param withTask 是否异步任务。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it.each([false, true])('replaces through copy, task=%s', async (withTask) => {
    f.withTask = withTask;
    f.files.set('/target/new.txt', Buffer.from('old'));
    const accepted = f.runs().trigger(f.copyJob().id, {
      dryRun: false,
      confirmDeletes: true,
    });
    expect((await terminal(f, accepted.id)).status).toBe('succeeded');
    expect(plan(f, accepted.id).map(status)).toEqual([
      'succeeded',
      'succeeded',
    ]);
    expect(f.files.get('/target/new.txt')).toEqual(
      f.files.get('/source/new.txt'),
    );
    expect(f.copyCount).toBe(1);
    expect(
      f.app.get(TaskResources).count(plan(f, accepted.id)[0].runTargetId),
    ).toBe(0);
    expect(f.tasks.size).toBe(0);
  });
  /** 源新鲜列表与旧计划不符不能删除旧文件。
   * @param failure 源观察失败模式。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it.each(['missing', 'unreadable'])(
    'keeps the old target when source is %s before remove',
    async (failure) => {
      f.files.set('/target/new.txt', Buffer.from('old'));
      f.fault =
        /** 只在执行的强制刷新窗口注入源变化。
         * @param call 请求。
         * @param response 正常响应。
         * @returns 故障响应。
         * @throws 不适用。
         */
        (call, response) =>
          call.url === '/api/fs/list' &&
          JSON.stringify(call.json).includes('"path":"/source"') &&
          JSON.stringify(call.json).includes('"refresh":true')
            ? failure === 'missing'
              ? listing()
              : envelope(null, 403)
            : response;
      const accepted = f.runs().trigger(f.copyJob().id, {
        dryRun: false,
        confirmDeletes: true,
      });
      await terminal(f, accepted.id);
      expect(f.files.get('/target/new.txt')).toEqual(Buffer.from('old'));
      expect(f.server.calls.filter(isRemove)).toHaveLength(0);
      expect(f.copyCount).toBe(0);
    },
  );
  /** 远程progress100仍须等待状态终态；用户取消只发一次cancel。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('holds quota while running and cancels once before cleanup', async () => {
    f.initialState = 1;
    const accepted = f.runs().trigger(f.copyJob().id, {
      dryRun: false,
      confirmDeletes: false,
    });
    await vi.waitFor(
      /** 等待已持久化tid。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 尚未提交。
       */
      () => expect(plan(f, accepted.id)[0]?.task).toBeTruthy(),
    );
    expect(
      f.app.get(TaskResources).count(plan(f, accepted.id)[0].runTargetId),
    ).toBe(1);
    f.runs().cancel(accepted.id);
    f.runs().cancel(accepted.id);
    expect((await terminal(f, accepted.id)).status).toBe('cancelled');
    expect(f.server.calls.filter(isCancel)).toHaveLength(1);
    expect(
      f.app.get(TaskResources).count(plan(f, accepted.id)[0].runTargetId),
    ).toBe(0);
  });
  /** tid404必须保留unknown但释放已不可跟踪的额度。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('records a missing task as unknown without retaining quota', async () => {
    f.initialState = 0;
    f.fault =
      /** 任务查询不可见。
       * @param call 请求。
       * @param response 默认响应。
       * @returns 查询404或默认。
       * @throws 不适用。
       */
      (call, response) =>
        call.url.includes('/copy/info') ? envelope(null, 404) : response;
    const run = await terminal(
      f,
      f.runs().trigger(f.copyJob().id, {
        dryRun: false,
        confirmDeletes: false,
      }).id,
    );
    expect(plan(f, run.id)[0].status).toBe('unknown');
    expect(f.app.get(TaskResources).count(plan(f, run.id)[0].runTargetId)).toBe(
      0,
    );
    const op = f.app
      .get(DatabaseService)
      .db.select()
      .from(operations)
      .where(eq(operations.runId, run.id))
      .get();
    expect(op?.remoteCleanupPending).toBe(false);
  });
  /** 旧计划仅恢复已知tid；不重新发copy且Run保持中断结论。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('restores a known task and ends interrupted without replay', async () => {
    const run = await preview(f, f.copyJob());
    const op = plan(f, run.id)[0];
    f.tasks.set('recovered', {
      state: 2,
      source: '/source/new.txt',
      destination: '/target/new.txt',
    });
    const db = f.app.get(DatabaseService).db;
    db.update(operations)
      .set({ status: 'submitted', openlistTaskId: 'recovered', remoteState: 0 })
      .where(eq(operations.id, op.id))
      .run();
    db.update(runs)
      .set({ status: 'executing', dryRun: false, endedAt: null })
      .where(eq(runs.id, run.id))
      .run();
    await f.restart();
    expect((await terminal(f, run.id)).status).toBe('interrupted');
    expect(plan(f, run.id)[0].status).toBe('succeeded');
    expect(f.copyCount).toBe(0);
  });
  /** 明确失败后的新attempt不能继承tid，部分目标仍先cleanup再copy。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('retries a failed task with a fresh tid after protected cleanup', async () => {
    await f.close();
    f = await copyFixture({ RETRY_MAX_ATTEMPTS: '2', RETRY_BASE_MS: '100' });
    f.initialState = 7;
    f.fault =
      /** 首次task失败留部分目标，后续task成功。
       * @param call 请求。
       * @param response 默认响应。
       * @returns 原协议响应。
       * @throws 不适用。
       */
      (call, response) => {
        if (call.url === '/api/fs/copy' && f.copyCount === 1) {
          f.files.set('/target/new.txt', Buffer.from('part'));
          f.initialState = 2;
        }
        return response;
      };
    const run = await terminal(
      f,
      f.runs().trigger(f.copyJob().id, {
        dryRun: false,
        confirmDeletes: true,
      }).id,
    );
    expect(run.status).toBe('succeeded');
    const rows = plan(f, run.id);
    const creates = rows.filter(
      /** 提取逻辑create的全部attempt。
       * @param op 操作。
       * @returns 是否create。
       * @throws 不适用。
       */
      (op) => op.action === 'create',
    );
    expect(creates.map(status)).toEqual(['failed', 'succeeded']);
    expect(creates[0].task?.id).not.toBe(creates[1].task?.id);
    expect(
      rows.some(
        /** 确认部分目标经过真实删除保护链。
         * @param op 操作。
         * @returns 是否成功cleanup。
         * @throws 不适用。
         */
        (op) => op.reason === 'retry_cleanup' && op.status === 'succeeded',
      ),
    ).toBe(true);
    expect(f.tasks.size).toBe(0);
  });
  /** copy错误后的单次新鲜观察与其他变更使用同一结果分类。
   * @param observed 目标是否已出现预期效果。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it.each([false, true])(
    'observes copy JSON500 exactly once, effect=%s',
    async (observed) => {
      f.withTask = false;
      f.fault =
        /** 保留或撤销效果后返回JSON500。
         * @param call 请求。
         * @param response 默认响应。
         * @returns 故障响应。
         * @throws 不适用。
         */
        (call, response) => {
          if (call.url !== '/api/fs/copy') return response;
          if (!observed) f.files.delete('/target/new.txt');
          return envelope(null, 500);
        };
      const run = await terminal(
        f,
        f.runs().trigger(f.copyJob().id, {
          dryRun: false,
          confirmDeletes: false,
        }).id,
      );
      const op = plan(f, run.id)[0];
      expect(op.status).toBe(observed ? 'succeeded' : 'failed');
      if (observed) expect(op.error?.code).toBe('OBSERVED_AFTER_ERROR');
      expect(f.copyCount).toBe(1);
    },
  );
});
/** 提取状态。
 * @param op 操作视图。
 * @returns 状态。
 * @throws 不适用。
 */
function status(op: { status: string }): string {
  return op.status;
}
/** 匹配删除请求。
 * @param call 请求。
 * @returns 是否remove。
 * @throws 不适用。
 */
function isRemove(call: { url: string }): boolean {
  return call.url === '/api/fs/remove';
}
/** 匹配task取消请求。
 * @param call 请求。
 * @returns 是否cancel。
 * @throws 不适用。
 */
function isCancel(call: { url: string }): boolean {
  return call.url.includes('/copy/cancel');
}
