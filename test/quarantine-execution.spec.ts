// 验证跨Job/别名隔离及已释放路径的强制刷新不会被缓存短路。
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { terminal, plan } from './m2-fixture.js';
import { envelope } from './openlist-fixture.js';
import { OperationsService } from '../src/runs/operations.service.js';
import { InstancesService } from '../src/instances/instances.service.js';
import { InstanceOperations } from '../src/instances/instance-operations.service.js';
import { object } from '../src/openlist/errors.js';

/** 注册真实执行中的隔离与删除保护。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M3 quarantine and deletion safety', () => {
  let f: RelayFixture;
  /** 建立隔离测试夹具。
   * @param 不适用。
   * @returns 初始化完成。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await relayFixture();
  });
  /** 关闭夹具。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    await f.close();
  });
  /** 产生真实init响应丢失的未知操作。
   * @param 不适用。
   * @returns Job和unknown记录。
   * @throws Error 断言失败。
   */
  async function unknown() {
    f.fault =
      /** 制造init响应丢失作为隔离前置条件。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws 不适用。
       */
      (call, response) =>
        call.url.endsWith('/init') ? { disconnect: true } : response;
    const job = f.job();
    const run = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: false }).id,
    );
    f.fault = undefined;
    return { job, op: plan(f, run.id)[0] };
  }
  /** 到期/释放不能把refresh失败解释为可写。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('skips a released path when required refresh fails but cached scanning succeeds', async () => {
    const { job, op } = await unknown();
    f.app.get(OperationsService).release(op.id, 'Reviewed');
    f.fault =
      /** 仅拒绝强制刷新以检验缓存不能放行写入。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws Error 测试协议数据非法。
       */
      (call, response) =>
        call.url === '/api/fs/list' &&
        object(call.json).path === '/target' &&
        object(call.json).refresh === true
          ? envelope(null, 403)
          : response;
    const before = f.server.calls.length;
    const run = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
    );
    expect(run.status).toBe('partial');
    expect(
      plan(f, run.id).some(
        /** 识别隔离阻断原因。
         * @param row 当前操作视图。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (row) => row.error?.code === 'PREVIOUS_OUTCOME_UNKNOWN',
      ),
    ).toBe(true);
    expect(
      f.server.calls.slice(before).some(
        /** 识别不应越过隔离的文件写入。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) => call.url.endsWith('/init') || call.url === '/api/fs/remove',
      ),
    ).toBe(false);
    expect(f.app.get(OperationsService).get(op.id).reobservedAt).toBeNull();
  });
  /** 不同Instance ID指向同一baseUrl时，不能绕过原未知责任。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('protects aliases across Jobs but keeps automatic resolution restricted to the original Instance', async () => {
    const { op } = await unknown();
    const alias = f.app.get(InstancesService).create({
      name: 'Alias',
      baseUrl: f.server.baseUrl,
      auth: { mode: 'token', secret: 'alias-token' },
    });
    await f.app.get(InstanceOperations).test(alias.id, { retryAuth: false });
    const job = f.job({ targets: [{ instanceId: alias.id, path: '/target' }] });
    const blocked = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
    );
    expect(blocked.status).toBe('partial');
    f.app.get(OperationsService).release(op.id, 'Allow fresh observation');
    const next = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
    );
    expect(next.status).toBe('succeeded');
    expect(f.app.get(OperationsService).get(op.id).resolution).toBeNull();
  });
  /** 源子树读取失败禁止真实替换和extras，纯新建仍可继续。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('never executes deletes after an incomplete source subtree', async () => {
    f.files.set('/source/sub', null);
    f.files.set('/target/new.txt', Buffer.from('old'));
    f.files.set('/target/extra.txt', Buffer.from('extra'));
    f.files.set('/source/fresh.txt', Buffer.from('new'));
    f.fault =
      /** 制造源子目录403以验证删除保护。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws Error 测试协议数据非法。
       */
      (call, response) =>
        call.url === '/api/fs/list' && object(call.json).path === '/source/sub'
          ? envelope(null, 403)
          : response;
    const job = f.job({
      targets: [
        {
          instanceId: f.id,
          path: '/target',
          mode: 'mirror',
          deleteLimits: { enabled: false },
        },
      ],
    });
    const run = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
    );
    expect(run.status).toBe('partial');
    expect(f.files.get('/target/new.txt')).toEqual(Buffer.from('old'));
    expect(f.files.get('/target/fresh.txt')).toEqual(Buffer.from('new'));
    expect(
      f.server.calls.some(
        /** 识别源不完整时禁止发生的删除。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) => call.url === '/api/fs/remove',
      ),
    ).toBe(false);
  });
  /** 管理员挂载列表失败不会退回宽松删除路径。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('does not delete when the administrator mount map is unavailable', async () => {
    f.files.set('/target/new.txt', Buffer.from('old'));
    const responder = f.server.responder;
    f.server.responder =
      /** 拒绝管理员挂载映射并保留其它正常请求。
       * @param call 真实HTTP请求及其捕获头。
       * @returns 不适用。
       * @throws 不适用。
       */
      (call) =>
        call.url.startsWith('/api/admin/storage/list')
          ? envelope(null, 500)
          : responder?.(call);
    const run = await terminal(
      f,
      f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: true }).id,
    );
    expect(run.status).toBe('partial');
    expect(
      f.server.calls.some(
        /** 识别挂载边界未知时禁止发生的删除。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) => call.url === '/api/fs/remove',
      ),
    ).toBe(false);
  });
  /** 父目录确已消失时用新鲜祖先列表证明，不永久阻塞合法新建。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('accepts a fresh ancestor absence proof for a released missing branch', async () => {
    const { job, op } = await unknown();
    f.app.get(OperationsService).release(op.id, 'Parent removed');
    f.files.delete('/target/new.txt');
    f.files.delete('/target');
    const result = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
    );
    expect(result.status).toBe('succeeded');
    expect(f.app.get(OperationsService).get(op.id).reobservedAt).not.toBeNull();
  });
  /** mkdir未知责任既要在无动作的观察Run解决，也要被后续成功mkdir覆盖。
   * @param missing 重新观察时目录是否已消失。
   * @param kind 预期独立解决方式。
   * @returns 原unknown不改写且责任已解决。
   * @throws Error 断言失败。
   */
  it.each([
    [false, 'observed'],
    [true, 'superseded'],
  ] as const)(
    'resolves an old mkdir with missing=%s as %s',
    async (missing, kind) => {
      f.files.delete('/target');
      f.files.delete('/source/new.txt');
      f.fault =
        /** 目录已创建但响应丢失，留下真实mkdir未知责任。
         * @param call 当前请求。
         * @param response 原响应。
         * @returns mkdir断连或原响应。
         * @throws 不适用。
         */
        (call, response) =>
          call.url === '/api/fs/mkdir' ? { disconnect: true } : response;
      const job = f.job({ syncEmptyDirs: true, allowEmptySource: true });
      const first = await terminal(
        f,
        f.runs().trigger(job.id, { dryRun: false, confirmDeletes: false }).id,
      );
      const unknown = plan(f, first.id)[0];
      expect(unknown).toMatchObject({ action: 'mkdir', status: 'unknown' });
      const management = f.app.get(OperationsService);
      management.release(unknown.id, 'Directory reviewed');
      f.fault = undefined;
      if (missing) f.files.delete('/target');
      const next = await terminal(
        f,
        f.runs().trigger(job.id, { dryRun: false, confirmDeletes: false }).id,
      );
      expect(next.status).toBe('succeeded');
      expect(management.get(unknown.id)).toMatchObject({
        status: 'unknown',
        resolution: { kind, runId: next.id },
      });
      if (!missing) expect(plan(f, next.id)).toEqual([]);
    },
  );
});
