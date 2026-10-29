// 验证根目录确认、非空保护及持久化和spool失败不会开放后续写入。
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { terminal, plan, listing } from './m2-fixture.js';
import { envelope, file } from './openlist-fixture.js';
import { Spool } from '../src/relay/spool.js';
import { OperationStore } from '../src/sync/operation-store.js';
import { object } from '../src/openlist/errors.js';
import { DatabaseService } from '../src/database/database.service.js';
import { operationAttempts } from '../src/database/operation-schema.js';

/** 注册失败证据行为，不以代码实现细节替代远端副作用断言。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M3 execution safety boundaries', () => {
  let f: RelayFixture;
  /** 每例采用两个文件级attempt，允许验证真实重试链。
   * @param 不适用。
   * @returns 夹具就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await relayFixture({ RETRY_MAX_ATTEMPTS: '2' });
  });
  /** 关闭本用例资源并恢复观测替身。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    vi.restoreAllMocks();
    await f.close();
  });
  /** 入口简化只固定已有公共默认值。
   * @param overrides Job配置差异。
   * @param confirmDeletes 是否放开数值删除预算。
   * @returns 终态运行。
   * @throws Error 执行或断言超时。
   */
  async function run(
    overrides: Record<string, unknown> = {},
    confirmDeletes = false,
  ) {
    return terminal(
      f,
      f.runs().trigger(f.job(overrides).id, { dryRun: false, confirmDeletes })
        .id,
    );
  }
  /** 创建新根成功不等于已能安全打开子动作。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it.each([false, true])(
    'keeps mkdir succeeded but blocks children when new-root refresh fails (immediate mkdir=%s)',
    async (immediate) => {
      f.files.delete('/target');
      f.files.set('/source/child', null);
      f.files.set('/source/child/file.txt', Buffer.from('nested'));
      let created = false;
      const mkdir = f.client.mkdir.bind(f.client);
      // 同时覆盖HTTP响应与派发器yield之前已收到成功响应的合法时序。
      const mkdirCalls = vi
        .spyOn(f.client, 'mkdir')
        .mockImplementation(async (instance, path, context) => {
          if (immediate && path === '/target') {
            context?.beforeDispatch?.();
            f.files.set(path, null);
            created = true;
            return;
          }
          await mkdir(instance, path, context);
        });
      f.fault =
        /** 在根mkdir之后拒绝列表以验证子动作屏障。
         * @param call 真实HTTP请求及其捕获头。
         * @param response 正常响应；stream回调时为测试HTTP响应。
         * @returns 本故障窗口对应的响应；其它请求保持原响应。
         * @throws Error 测试协议数据非法。
         */
        (call, response) => {
          if (call.url === '/api/fs/mkdir') created = true;
          return created &&
            call.url === '/api/fs/list' &&
            object(call.json).path === '/target'
            ? envelope(null, 500)
            : response;
        };
      const result = await run();
      expect(result.status).toBe('partial');
      expect(plan(f, result.id)[0].status).toBe('succeeded');
      expect(mkdirCalls.mock.calls.map((call) => call[1])).toEqual(['/target']);
      expect(
        f.server.calls.some(
          /** 识别根确认失败后禁止发生的init。
           * @param call 真实HTTP请求及其捕获头。
           * @returns 满足上述请求或操作条件时返回true。
           * @throws 不适用。
           */
          (call) => call.url.endsWith('/init'),
        ),
      ).toBe(false);
    },
  );
  /** 扫描之后目录变非空，不能递归删除后来出现的文件。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('skips an extra directory which becomes nonempty before removal', async () => {
    f.files.set('/target/extra', null);
    f.fault =
      /** 在删除前刷新时插入新文件以验证非空目录保护。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws Error 测试协议数据非法。
       */
      (call, response) => {
        if (
          call.url === '/api/fs/list' &&
          object(call.json).path === '/target/extra' &&
          object(call.json).refresh === true
        ) {
          f.files.set('/target/extra/new.txt', Buffer.from('later'));
          return listing({ ...file('new.txt'), size: 5 });
        }
        return response;
      };
    const result = await run({
      syncEmptyDirs: true,
      targets: [
        {
          instanceId: f.id,
          path: '/target',
          mode: 'mirror',
          deleteLimits: { enabled: false },
        },
      ],
    });
    expect(result.status).toBe('partial');
    expect(f.files.has('/target/extra/new.txt')).toBe(true);
    expect(
      plan(f, result.id).some(
        /** 取得目录前提变化的跳过结果。
         * @param op 当前操作视图。
         * @returns 用于当前断言的字段。
         * @throws 不适用。
         */
        (op) => op.isDir && op.error?.code === 'PRECONDITION_CHANGED',
      ),
    ).toBe(true);
  });
  /** session持久化失败绝不开始chunk，提交窗口保留未知责任。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('does not send chunks when the session persistence checkpoint fails', async () => {
    vi.spyOn(OperationStore.prototype, 'session').mockImplementation(
      /** 模拟session事务失败，禁止继续发送chunk。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 注入的持久化失败。
       */
      () => {
        throw new Error('Injected persistence failure');
      },
    );
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('INTERNAL_ERROR');
    expect(plan(f, result.id)[0].status).toBe('unknown');
    expect(
      f.server.calls.some(
        /** 识别session未落库时禁止发生的chunk。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) => call.url.endsWith('/chunk'),
      ),
    ).toBe(false);
  });
  /** 容量不足例外必须在session落库后主动abort且不重复init。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('fails insufficient standalone frontier capacity after persisting the session', async () => {
    const spool = f.app.get(Spool);
    let initialized = false;
    let recorded = false;
    vi.spyOn(spool, 'available').mockImplementation(
      /** 仅在init之后降低可用容量以触发显式容量例外。
       * @param 不适用。
       * @returns 模拟文件系统的可用字节数。
       * @throws 不适用。
       */
      async () => (initialized ? 1 : 10485760),
    );
    f.fault =
      /** 记录主动abort之前session是否已经落库。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws 不适用。
       */
      (call, response) => {
        if (call.url.endsWith('/init')) initialized = true;
        if (call.url.endsWith('/abort'))
          recorded = f.app
            .get(DatabaseService)
            .db.select()
            .from(operationAttempts)
            .all()
            .some(
              /** 检查是否保存了真实upload_id。
               * @param op 当前操作视图。
               * @returns 满足上述请求或操作条件时返回true。
               * @throws 不适用。
               */
              (op) => op.multipartUploadId !== null,
            );
        return response;
      };
    const result = await run();
    expect(recorded).toBe(true);
    expect(plan(f, result.id)[0]).toMatchObject({
      status: 'failed',
      error: { code: 'SPOOL_FULL', message: 'insufficient spool capacity' },
    });
    expect(
      f.server.calls.filter(
        /** 筛选init以核对容量不变时未循环创建session。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) => call.url.endsWith('/init'),
      ),
    ).toHaveLength(1);
  });
  /** 实际payload小于chunk_size时不能按完整名义chunk拒绝。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('admits a small final payload even when a nominal chunk would not fit', async () => {
    vi.spyOn(f.app.get(Spool), 'available').mockResolvedValue(32);
    expect((await run()).status).toBe('succeeded');
  });
});
