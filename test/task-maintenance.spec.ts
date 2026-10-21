// 验证维护责任分类、远端重试边沿与不可改写的历史统计。
import { eq } from 'drizzle-orm';
import { copyFixture } from './copy-fixture.js';
import type { CopyFixture } from './copy-fixture.js';
import { preview, plan } from './m2-fixture.js';
import { envelope } from './openlist-fixture.js';
import { DatabaseService } from '../src/database/database.service.js';
import { operations } from '../src/database/operation-schema.js';
import { RemoteTaskMaintenance } from '../src/maintenance/remote-tasks.js';
import { OperationsService } from '../src/runs/operations.service.js';
import { TaskResources } from '../src/coordination/task-resources.js';

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
  async function flagged(unknown: boolean, state: number) {
    const run = await preview(f, f.job({ createMode: 'server_copy' }));
    const id = plan(f, run.id)[0].id;
    f.app
      .get(DatabaseService)
      .db.update(operations)
      .set({
        status: unknown ? 'unknown' : 'succeeded',
        endedAt: Date.now(),
        unknownSince: unknown ? Date.now() : null,
        unknownUntil: unknown ? Date.now() + 86400000 : null,
        openlistTaskId: id,
        remoteState: state,
        remoteCleanupPending: true,
      })
      .where(eq(operations.id, id))
      .run();
    f.tasks.set(id, {
      state,
      source: '/source/new.txt',
      destination: '/target/new.txt',
    });
    if (![2, 4, 7].includes(state)) f.app.get(TaskResources).hold(id, f.id);
    return { id, run };
  }
  /** 安全未知不可因网络错误清理，abandon只改resolution，下轮才可放弃housekeeping。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('retains safety tracking, then gives up resolved housekeeping after failed info', async () => {
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
    expect(record(id).remoteCleanupPending).toBe(true);
    f.app.get(OperationsService).abandon(id, 'Operator accepts unknown');
    expect(record(id).remoteCleanupPending).toBe(true);
    expect(f.app.get(TaskResources).count(f.id)).toBe(1);
    await maintenance.one(id);
    expect(record(id).remoteCleanupPending).toBe(false);
    expect(f.app.get(TaskResources).count(f.id)).toBe(0);
    await f.restart();
    expect(f.app.get(TaskResources).count(f.id)).toBe(0);
  });
  /** 同一远端边沿只有一条维护行，历史统计及默认查询不改变。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('creates one unknown per terminal-to-nonterminal edge and preserves stats', async () => {
    const { id, run } = await flagged(false, 2);
    const task = f.tasks.get(id);
    if (!task) throw new Error('Missing task');
    task.state = 1;
    const maintenance = f.app.get(RemoteTaskMaintenance);
    await maintenance.one(id);
    await maintenance.one(id);
    expect(plan(f, run.id)).toHaveLength(1);
    const all = f
      .runs()
      .operations(run.id, {
        page: 1,
        pageSize: 200,
        includeMaintenance: true,
      }).items;
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({
      status: 'unknown',
      causedByOperationId: id,
      task: null,
    });
    expect(f.runs().get(run.id).stats).toEqual(run.stats);
    expect(record(id).remoteState).toBe(1);
    expect(f.app.get(TaskResources).count(f.id)).toBe(1);
    f.app.get(OperationsService).abandon(all[1].id, 'Accept incident');
    await maintenance.one(id);
    expect(record(id).remoteCleanupPending).toBe(true);
    task.state = 2;
    await maintenance.one(id);
    expect(record(id).remoteCleanupPending).toBe(false);
    expect(record(id).status).toBe('succeeded');
    expect(f.app.get(TaskResources).count(f.id)).toBe(0);
  });
  /** 异步info期间resolution变化必须使旧条件写入失效。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('does not apply a stale response after resolution changes', async () => {
    const { id } = await flagged(true, 1);
    f.fault =
      /** 在已发起的info响应前插入管理动作。
       * @param call 请求。
       * @param response 原响应。
       * @returns 404或原响应。
       * @throws Error 管理动作失败。
       */
      (call, response) => {
        if (!call.url.includes('/copy/info')) return response;
        f.app.get(OperationsService).abandon(id, 'Concurrent decision');
        return envelope(null, 404);
      };
    await f.app.get(RemoteTaskMaintenance).one(id);
    expect(record(id).remoteCleanupPending).toBe(true);
    expect(record(id).resolutionKind).toBe('abandoned');
  });
  /** 取得原始持久行。
   * @param id 操作ID。
   * @returns 完整行。
   * @throws Error 夹具丢失。
   */
  function record(id: string) {
    const row = f.app
      .get(DatabaseService)
      .db.select()
      .from(operations)
      .where(eq(operations.id, id))
      .get();
    if (!row) throw new Error('Operation missing');
    return row;
  }
});
