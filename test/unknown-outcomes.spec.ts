// 验证未知结果只保留历史，跨 Run 重新规划仍遵守本轮依赖和删除保护。
import { eq } from 'drizzle-orm';
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { terminal, plan } from './m2-fixture.js';
import { envelope } from './openlist-fixture.js';
import { OperationsService } from '../src/runs/operations.service.js';
import { InstancesService } from '../src/instances/instances.service.js';
import { InstanceOperations } from '../src/instances/instance-operations.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { operationAttempts } from '../src/database/operation-schema.js';
import { object } from '../src/openlist/errors.js';

/** 注册真实 HTTP、SQLite 和文件流水线的未知结果回归。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('unknown outcome history and execution safety', () => {
  let f: RelayFixture;
  /** 每例允许一次文件重试，用于证明 unknown 不消耗第二次提交。
   * @returns 独立夹具就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await relayFixture({ RETRY_MAX_ATTEMPTS: '2', RETRY_BASE_MS: '100' });
  });
  /** 关闭测试自己的服务与数据库。
   * @returns 资源已释放。
   * @throws Error 关闭失败。
   */
  afterEach(async () => {
    await f.close();
  });

  /** 真实 init 已执行但响应丢失；保留历史行供下一轮比较。
   * @returns Job 和完整未知结果。
   * @throws Error 执行或断言失败。
   */
  async function unknown() {
    f.fault = (call, response) =>
      call.url.endsWith('/init') ? { disconnect: true } : response;
    const job = f.job();
    const run = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: false }).id,
    );
    f.fault = undefined;
    const op = plan(f, run.id)[0];
    expect(op.status).toBe('unknown');
    expect(
      f.server.calls.filter((call) => call.url.endsWith('/init')),
    ).toHaveLength(1);
    return { job, op };
  }

  /** 目标的本轮观察决定新建、替换或 unchanged，不修改历史记录。
   * @param state 下次扫描时目标实际状态。
   * @returns 本轮修复完成且历史保持原样。
   * @throws Error 断言失败。
   */
  it.each(['missing', 'different', 'same'] as const)(
    'plans from the next scan when the target is %s',
    async (state) => {
      const { job, op } = await unknown();
      if (state === 'missing') f.files.delete('/target/new.txt');
      else
        f.files.set(
          '/target/new.txt',
          state === 'same' ? Buffer.from('hello relay!') : Buffer.from('old'),
        );
      const next = await terminal(
        f,
        f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
      );
      expect(next.status).toBe('succeeded');
      expect(plan(f, next.id).map((row) => row.action)).toEqual(
        state === 'same'
          ? []
          : state === 'missing'
            ? ['create']
            : ['delete', 'create'],
      );
      expect(f.files.get('/target/new.txt')).toEqual(
        Buffer.from('hello relay!'),
      );
      expect(f.app.get(OperationsService).get(op.id)).toEqual(op);
    },
  );

  /** 历史未知不把配置为缓存扫描的目录改成强制刷新。
   * @returns 不请求失败的强制观察也能创建缺失文件。
   * @throws Error 断言失败。
   */
  it('honors configured refresh without imposing historical observation', async () => {
    const { job, op } = await unknown();
    f.files.delete('/target/new.txt');
    const before = f.server.calls.length;
    f.fault = (call, response) =>
      call.url === '/api/fs/list' &&
      object(call.json).path === '/target' &&
      object(call.json).refresh === true
        ? envelope(null, 403)
        : response;
    const next = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
    );
    expect(next.status).toBe('succeeded');
    expect(
      f.server.calls
        .slice(before)
        .filter(
          (call) =>
            call.url === '/api/fs/list' && object(call.json).path === '/target',
        )
        .every((call) => object(call.json).refresh === false),
    ).toBe(true);
    expect(f.app.get(OperationsService).get(op.id)).toEqual(op);
  });

  /** 别名实例的后续 Run 也只依据当前扫描，无需历史管理操作。
   * @returns 新实例成功写入且原结果不变。
   * @throws Error 断言失败。
   */
  it('allows a later Job through an account alias without changing old history', async () => {
    const { op } = await unknown();
    const alias = f.app.get(InstancesService).create({
      name: 'Alias',
      baseUrl: f.server.baseUrl,
      auth: { mode: 'token', secret: 'alias-token' },
    });
    await f.app.get(InstanceOperations).test(alias.id, { retryAuth: false });
    const job = f.job({ targets: [{ instanceId: alias.id, path: '/target' }] });
    const next = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
    );
    expect(next.status).toBe('succeeded');
    expect(f.app.get(OperationsService).get(op.id)).toEqual(op);
  });

  /** 前轮未知的后代文件不阻止本轮按源视图删除额外文件和空祖先目录。
   * @returns mirror 删除完成，历史记录保持 unknown。
   * @throws Error 断言失败。
   */
  it('deletes mirror extras and empty ancestors despite historical unknown descendants', async () => {
    f.files.set('/source/sub', null);
    f.files.set('/source/sub/file.txt', Buffer.from('data'));
    f.files.delete('/source/new.txt');
    const job = f.job({
      syncEmptyDirs: true,
      allowEmptySource: true,
      targets: [{ instanceId: f.id, path: '/target', mode: 'mirror' }],
    });
    f.fault = (call, response) =>
      call.url.endsWith('/init') ? { disconnect: true } : response;
    const first = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
    );
    const old = plan(f, first.id).find((op) => op.status === 'unknown');
    if (!old) throw new Error('Expected unknown create');
    f.fault = undefined;
    f.files.delete('/source/sub/file.txt');
    f.files.delete('/source/sub');
    const next = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
    );
    expect(next.status).toBe('succeeded');
    expect(f.files.has('/target/sub/file.txt')).toBe(false);
    expect(f.files.has('/target/sub')).toBe(false);
    expect(f.app.get(OperationsService).get(old.id)).toEqual(old);
  });

  /** 结果未知的父 mkdir 或替换 delete 不能放行同轮 create，也不自动重试。
   * @param action 制造未知结果的依赖动作。
   * @returns 下游被依赖关系阻止。
   * @throws Error 断言失败。
   */
  it.each(['mkdir', 'remove'] as const)(
    'does not release a create after an unknown %s in the same Run',
    async (action) => {
      if (action === 'mkdir') f.files.delete('/target');
      else f.files.set('/target/new.txt', Buffer.from('old'));
      f.fault = (call, response) =>
        call.url === `/api/fs/${action}` ? { disconnect: true } : response;
      const run = await terminal(
        f,
        f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: true })
          .id,
      );
      expect(plan(f, run.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'unknown' }),
          expect.objectContaining({
            action: 'create',
            status: 'skipped',
            error: expect.objectContaining({ code: 'DEPENDENCY_FAILED' }),
          }),
        ]),
      );
      expect(
        f.server.calls.filter((call) => call.url === `/api/fs/${action}`),
      ).toHaveLength(1);
      expect(f.server.calls.some((call) => call.url.endsWith('/init'))).toBe(
        false,
      );
    },
  );

  /** 本轮未知 create 仍阻止同一 Target 的 mirror extras。
   * @returns 额外文件保留且新建只提交一次。
   * @throws Error 断言失败。
   */
  it('keeps current-Run mirror protection after an unknown create', async () => {
    f.files.set('/target/extra.txt', Buffer.from('extra'));
    f.fault = (call, response) =>
      call.url.endsWith('/init') ? { disconnect: true } : response;
    const job = f.job({
      targets: [{ instanceId: f.id, path: '/target', mode: 'mirror' }],
    });
    const run = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
    );
    expect(run.targets[0].extrasBlocked).toBe(true);
    expect(f.files.get('/target/extra.txt')).toEqual(Buffer.from('extra'));
    expect(
      f.server.calls.filter((call) => call.url.endsWith('/init')),
    ).toHaveLength(1);
    expect(plan(f, run.id).find((op) => op.reason === 'extra')).toMatchObject({
      status: 'skipped',
      error: { code: 'DELETE_BLOCKED' },
    });
  });

  /** 上游可复用旧失败 session ID；新尝试先记录失败并 abort，再提交全新 session。
   * @returns 旧结果不变，复用 ID 不造成数据库失败，不给失败 session 发送 chunk。
   * @throws Error 断言失败。
   */
  it('records a reused historical upload ID and retries only after aborting the failed session', async () => {
    f.fault = (call, response) =>
      call.url.endsWith('/complete') ? { disconnect: true } : response;
    const job = f.job();
    const first = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
    );
    const old = plan(f, first.id)[0];
    expect(old.status).toBe('unknown');
    const uploadId = old.attempts[0].multipart?.uploadId;
    if (!uploadId) throw new Error('Missing historical session');
    f.fault = undefined;
    f.files.delete('/target/new.txt');
    const respond = f.server.responder;
    let resumed = false;
    f.server.responder = (call) => {
      if (call.url.endsWith('/init') && !resumed) {
        resumed = true;
        return envelope({
          upload_id: uploadId,
          state: 'failed_retriable',
          attempt: 1,
          chunk_size: 1048576,
          total_chunks: 1,
          received: null,
          received_bytes: 0,
          frontier: 0,
        });
      }
      if (
        call.url.endsWith('/abort') &&
        call.headers['x-upload-id'] === uploadId
      )
        return envelope(null);
      return respond?.(call);
    };
    const before = f.server.calls.length;
    const next = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
    );
    expect(next.status).toBe('succeeded');
    const attempts = plan(f, next.id)
      .filter((op) => op.action === 'create')
      .flatMap((op) => op.attempts);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      status: 'failed',
      multipart: { uploadId },
    });
    expect(attempts[1]).toMatchObject({
      status: 'succeeded',
      attemptNo: 2,
    });
    expect(attempts[1].multipart?.uploadId).not.toBe(uploadId);
    expect(f.app.get(OperationsService).get(old.id)).toEqual(old);
    expect(f.files.get('/target/new.txt')).toEqual(Buffer.from('hello relay!'));
    const calls = f.server.calls.slice(before);
    expect(
      calls.filter(
        (call) =>
          call.url.endsWith('/chunk') &&
          call.headers['x-upload-id'] === uploadId,
      ),
    ).toHaveLength(0);
    const abort = calls.findIndex(
      (call) =>
        call.url.endsWith('/abort') && call.headers['x-upload-id'] === uploadId,
    );
    const freshInit = calls.findLastIndex((call) => call.url.endsWith('/init'));
    expect(abort).toBeGreaterThan(-1);
    expect(freshInit).toBeGreaterThan(abort);
    expect(
      f.app
        .get(DatabaseService)
        .db.select()
        .from(operationAttempts)
        .where(eq(operationAttempts.multipartUploadId, uploadId))
        .all(),
    ).toHaveLength(2);
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
});
