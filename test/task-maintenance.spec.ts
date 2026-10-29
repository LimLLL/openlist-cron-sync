// 验证维护责任分类、远端重试边沿与不可改写的历史统计。
import { eq } from 'drizzle-orm';
import { copyFixture } from './copy-fixture.js';
import type { CopyFixture } from './copy-fixture.js';
import { preview, plan } from './m2-fixture.js';
import { envelope } from './openlist-fixture.js';
import { DatabaseService } from '../src/database/database.service.js';
import { operations } from '../src/database/operation-schema.js';
import { RemoteTaskMaintenance } from '../src/maintenance/remote-tasks.js';
import { TaskResources } from '../src/coordination/task-resources.js';
import { executionRecord } from '../src/database/operation-records.js';
import { setOperation } from './operation-fixture.js';

/** 注册维护行为。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M6 task maintenance responsibility', () => {
  let f: CopyFixture;
  /** 建立隔离数据库。
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
  /** 构造进程已退出留下的终态task责任。
   * @param unknown 是否本地未知。
   * @param state 最后持久状态。
   * @returns 原行ID和Run。
   * @throws Error 数据库失败。
   */
  async function flagged(unknown: boolean, state: number, job = f.copyJob()) {
    const run = await preview(f, job);
    const id = plan(f, run.id)[0].id;
    setOperation(f.app.get(DatabaseService).db, eq(operations.id, id), {
      status: unknown ? 'unknown' : 'succeeded',
      endedAt: Date.now(),
      unknownSince: unknown ? Date.now() : null,
      openlistTaskId: id,
      remoteState: state,
      remoteCleanupPending: true,
    });
    f.tasks.set(id, {
      state,
      source: '/source/new.txt',
      destination: '/target/new.txt',
    });
    if (![2, 4, 7].includes(state))
      f.app.get(TaskResources).hold(id, record(id).runTargetId);
    return { id, run };
  }
  /** Detached maintenance deliberately uses the process-current retry budget, not a Run snapshot.
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('uses process-current attempts for detached cleanup', async () => {
    const { id } = await flagged(false, 2, f.copyJob({ retryCount: 2 }));
    f.fault =
      /** 让删除结果保持未知，观察维护使用环境默认的一次尝试。
       * @param call 捕获请求。
       * @param response 默认响应。
       * @returns 故障或默认响应。
       * @throws 不适用。
       */
      (call, response) =>
        call.url.includes('/copy/delete_some')
          ? envelope({ [id]: 'still-present' })
          : response;
    await f.app.get(RemoteTaskMaintenance).one(id);
    expect(
      f.server.calls.filter((call) => call.url.includes('/copy/delete_some')),
    ).toHaveLength(1);
    expect(record(id).remoteCleanupPending).toBe(false);
  });
  /** 未知历史使用相同的有界 task 删除策略，观察失败后释放本地责任。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('ends detached housekeeping after failed observation without changing unknown history', async () => {
    const { id } = await flagged(true, 1);
    f.fault =
      /** 不可读取远程task。
       * @param call 请求。
       * @param response 默认响应。
       * @returns 403或默认。
       * @throws 不适用。
       */
      (call, response) =>
        call.url.includes('/copy/info') ? envelope(null, 403) : response;
    const maintenance = f.app.get(RemoteTaskMaintenance);
    await maintenance.one(id);
    expect(record(id).status).toBe('unknown');
    expect(record(id).remoteCleanupPending).toBe(false);
    expect(f.app.get(TaskResources).count(record(id).runTargetId)).toBe(0);
    await f.restart();
    expect(f.app.get(TaskResources).count(record(id).runTargetId)).toBe(0);
  });
  /** 远端终态逆转只更新状态并继续占用额度，不新增操作或改写历史统计。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('tracks restarted tasks without creating operations or changing historical outcomes', async () => {
    const { id, run } = await flagged(false, 2);
    const task = f.tasks.get(id);
    if (!task) throw new Error('Missing task');
    task.state = 1;
    const maintenance = f.app.get(RemoteTaskMaintenance);
    await maintenance.one(id);
    await maintenance.one(id);
    expect(plan(f, run.id)).toHaveLength(1);
    const all = f.runs().operations(run.id, {
      page: 1,
      pageSize: 200,
    }).items;
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id,
      status: 'succeeded',
    });
    expect(plan(f, run.id)[0].attempts[0].task).toEqual({ id, state: 1 });
    expect(
      f.server.calls.some((call) => call.url.includes('/copy/delete_some')),
    ).toBe(false);
    expect(f.runs().get(run.id).stats).toEqual(run.stats);
    expect(record(id).remoteState).toBe(1);
    expect(f.app.get(TaskResources).count(record(id).runTargetId)).toBe(1);
    await maintenance.one(id);
    expect(record(id).remoteCleanupPending).toBe(true);
    task.state = 2;
    await maintenance.one(id);
    expect(record(id).remoteCleanupPending).toBe(false);
    expect(record(id).status).toBe('succeeded');
    expect(f.app.get(TaskResources).count(record(id).runTargetId)).toBe(0);
  });
  /** 异步 info 期间远程事实变化必须使旧条件写入失效。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('does not apply a stale response after a newer remote state is committed', async () => {
    const { id } = await flagged(true, 1);
    f.fault =
      /** 在已发起的 info 响应前提交较新的远程事实。
       * @param call 请求。
       * @param response 原响应。
       * @returns 404或原响应。
       * @throws Error 数据库失败。
       */
      (call, response) => {
        if (!call.url.includes('/copy/info')) return response;
        setOperation(f.app.get(DatabaseService).db, eq(operations.id, id), {
          remoteState: 2,
        });
        return envelope(null, 404);
      };
    await f.app.get(RemoteTaskMaintenance).one(id);
    expect(record(id).remoteCleanupPending).toBe(true);
    expect(record(id).remoteState).toBe(2);
    expect(record(id).status).toBe('unknown');
  });
  /** 取得原始持久行。
   * @param id 操作ID。
   * @returns 完整行。
   * @throws Error 夹具丢失。
   */
  function record(id: string) {
    const row = executionRecord(f.app.get(DatabaseService).db, id);
    if (!row) throw new Error('Operation missing');
    return row;
  }
});
