// 验证已知task恢复期限、额度重建及SIGTERM不发送远端cancel。
import { eq } from 'drizzle-orm';
import { copyFixture } from './copy-fixture.js';
import type { CopyFixture } from './copy-fixture.js';
import { preview, plan, terminal } from './m2-fixture.js';
import { DatabaseService } from '../src/database/database.service.js';
import { operations } from '../src/database/operation-schema.js';
import { runs } from '../src/database/run-schema.js';
import { TaskResources } from '../src/coordination/task-resources.js';
import { InstancesService } from '../src/instances/instances.service.js';
import { envelope } from './openlist-fixture.js';

/** 注册恢复和关闭窗口。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M6 recovery task ownership', () => {
  let f: CopyFixture;
  /** 使用短取消宽限，恢复时间通过持久事实驱动。
   * @param 不适用。
   * @returns 就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await copyFixture({ CANCEL_GRACE_SECONDS: '1' });
  });
  /** 清理本地资源。
   * @param 不适用。
   * @returns 退出。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    await f.close();
  });
  /** 构造具有已知tid的旧执行Run。
   * @param deadline 首次恢复截止时刻。
   * @returns Run ID和Operation ID。
   * @throws Error SQL失败。
   */
  async function recovering(deadline: number, job = f.copyJob()) {
    const run = await preview(f, job);
    const id = plan(f, run.id)[0].id;
    const db = f.app.get(DatabaseService).db;
    db.update(operations)
      .set({ status: 'running', openlistTaskId: id, remoteState: 1 })
      .where(eq(operations.id, id))
      .run();
    db.update(runs)
      .set({
        status: 'recovering',
        dryRun: false,
        endedAt: null,
        recoveryDeadlineAt: deadline,
      })
      .where(eq(runs.id, run.id))
      .run();
    f.tasks.set(id, {
      state: 1,
      source: '/source/new.txt',
      destination: '/target/new.txt',
    });
    return { runId: run.id, id };
  }
  /** 恢复轮询使用接受时的Job重试预算，即使进程默认值更小。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('keeps the frozen retry budget across recovery', async () => {
    const job = f.copyJob({ retryCount: 2 });
    const old = await recovering(Date.now() + 5000, job);
    f.fault =
      /** 返回合法JSON但错误task身份，制造可计数的协议失败。
       * @param call 捕获请求。
       * @param response 默认响应。
       * @returns 故障或默认响应。
       * @throws 不适用。
       */
      (call, response) =>
        call.url.includes('/copy/info')
          ? envelope({
              id: 'wrong-task-id',
              name: 'fixture copy',
              state: 1,
              status: '',
              progress: 0,
              error: '',
              start_time: null,
              end_time: null,
              total_bytes: 12,
            })
          : response;
    await f.restart();
    await terminal(f, old.runId);
    expect(f.runs().get(old.runId).config.settings.retryMaxAttempts).toBe(3);
    expect(
      f.server.calls.filter((call) => call.url.includes('/copy/info')),
    ).toHaveLength(3);
  });
  /** 多个恢复tid先计额度；恢复中的取消与期限到达共用一次cancel。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('restores over-capacity occupancy and shares cancellation with recovery expiry', async () => {
    f.app
      .get(InstancesService)
      .patch(f.id, { limits: { maxOutstandingTasks: 1 } });
    const first = await recovering(Date.now() + 5000);
    const second = await recovering(Date.now() + 5000);
    await f.restart();
    expect(f.app.get(TaskResources).count(f.id)).toBe(2);
    f.runs().cancel(first.runId);
    f.runs().cancel(first.runId);
    f.runs().cancel(second.runId);
    expect((await terminal(f, first.runId)).status).toBe('interrupted');
    expect((await terminal(f, second.runId)).status).toBe('interrupted');
    expect(f.server.calls.filter(cancelRequest)).toHaveLength(2);
    expect(f.app.get(TaskResources).count(f.id)).toBe(0);
  });
  /** 已过固定宽限的恢复不会再产生一个新cancel窗口。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('does not renew expired final grace after restart', async () => {
    const old = await recovering(Date.now() - 5000);
    await f.restart();
    expect((await terminal(f, old.runId)).status).toBe('interrupted');
    expect(plan(f, old.runId)[0]).toMatchObject({
      status: 'unknown',
      task: { id: old.id },
    });
    expect(f.server.calls.filter(cancelRequest)).toHaveLength(0);
    expect(f.app.get(TaskResources).count(f.id)).toBe(1);
  });
  /** 取消无终态证据必须unknown，不能delete仍运行的task。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('retains a task when cancellation remains unconfirmed', async () => {
    const old = await recovering(Date.now() - 100);
    f.fault =
      /** 模拟cancel响应拒绝且info持续running。
       * @param call 请求。
       * @param response 默认响应。
       * @returns 故障或默认响应。
       * @throws 不适用。
       */
      (call, response) => {
        if (call.url.includes('/copy/cancel')) {
          const task = f.tasks.get(old.id);
          if (task) task.state = 1;
          return envelope(null, 403);
        }
        return response;
      };
    await f.restart();
    await terminal(f, old.runId);
    expect(plan(f, old.runId)[0].status).toBe('unknown');
    expect(f.server.calls.filter(cancelRequest)).toHaveLength(1);
    expect(f.server.calls.some(deleteRequest)).toBe(false);
  });
  /** 正常关闭保留已知submitted/running，重启继续观察而非重新copy。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('never cancels or deletes a running copy on shutdown', async () => {
    f.initialState = 1;
    const run = f
      .runs()
      .trigger(f.copyJob().id, {
        dryRun: false,
        confirmDeletes: false,
      });
    await vi.waitFor(
      /** 等待数据库保存tid。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 尚未提交。
       */
      () => expect(plan(f, run.id)[0]?.task).toBeTruthy(),
    );
    await f.restart();
    expect(f.server.calls.filter(cancelRequest)).toHaveLength(0);
    expect(f.server.calls.some(deleteRequest)).toBe(false);
    expect(f.runs().get(run.id).status).toBe('recovering');
    const tid = plan(f, run.id)[0].task?.id;
    const task = tid ? f.tasks.get(tid) : undefined;
    if (!task) throw new Error('Missing task');
    task.state = 2;
    expect((await terminal(f, run.id)).status).toBe('interrupted');
    expect(f.copyCount).toBe(1);
  });
});
/** 匹配cancel请求。
 * @param call 捕获请求。
 * @returns 是否cancel。
 * @throws 不适用。
 */
function cancelRequest(call: { url: string }): boolean {
  return call.url.includes('/copy/cancel');
}
/** 匹配delete_some。
 * @param call 捕获请求。
 * @returns 是否清理task。
 * @throws 不适用。
 */
function deleteRequest(call: { url: string }): boolean {
  return call.url.includes('/copy/delete_some');
}
