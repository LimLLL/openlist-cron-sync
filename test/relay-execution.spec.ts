// 从真实Run入口验证relay、替换和mirror副作用，而不是模拟内部执行器。
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { plan, terminal } from './m2-fixture.js';
import { envelope } from './openlist-fixture.js';

/** 注册真实执行行为验收。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M3 combined relay execution', () => {
  let f: RelayFixture;
  /** 每个用例拥有独立上游和SQLite。
   * @param 不适用。
   * @returns 初始化完成。
   * @throws Error 夹具失败。
   */
  beforeEach(async () => {
    f = await relayFixture();
  });
  /** 关闭全部测试资源。
   * @param 不适用。
   * @returns 资源清理完成。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    await f.close();
  });
  /** 创建多chunk文件并校验完整字节及持久EOF。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('creates new files using the real pipeline and persists EOF before completion', async () => {
    const data = Buffer.alloc(2 * 1048576 + 17, 73);
    f.files.set('/source/new.txt', data);
    const run = await terminal(
      f,
      f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: false }).id,
    );
    expect(run.status).toBe('succeeded');
    const actual = f.files.get('/target/new.txt');
    expect(Buffer.isBuffer(actual) && actual.equals(data)).toBe(true);
    expect(run.stats).toMatchObject({
      succeededCreates: 1,
      transferredBytes: data.length,
      downloadedBytes: data.length,
    });
    expect(plan(f, run.id)[0].attempts[0]).toMatchObject({
      status: 'succeeded',
      multipart: {
        state: 'completed',
        sourceStreamCompletedAt: expect.any(String),
      },
    });
  });
  /** 源首块之后才删除，目标create成功后才开放extras。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('replaces first, then deletes mirror files and empty directories bottom-up', async () => {
    f.files.set('/target/new.txt', Buffer.from('old'));
    f.files.set('/target/extra', null);
    f.files.set('/target/extra/nested', null);
    f.files.set('/target/extra/nested/old.txt', Buffer.from('extra'));
    const job = f.job({
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
    const run = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: false }).id,
    );
    expect(run.status).toBe('succeeded');
    expect(f.files.has('/target/extra')).toBe(false);
    expect(run.stats).toMatchObject({
      succeededCreates: 1,
      deletedForReplace: 1,
      deletedAsExtra: 1,
      plannedDirectoryDeletes: 2,
    });
    const calls = f.server.calls;
    expect(
      calls.findIndex(
        /** 定位源下载以核对先读后删顺序。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 用于当前断言的字段。
         * @throws 不适用。
         */
        (call) => call.url.startsWith('/d/'),
      ),
    ).toBeLessThan(
      calls.findIndex(
        /** 定位首次删除以核对先读后删顺序。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 用于当前断言的字段。
         * @throws 不适用。
         */
        (call) => call.url === '/api/fs/remove',
      ),
    );
    const remove = calls.filter(
      /** 筛选删除调用以核对自底向上的顺序。
       * @param call 真实HTTP请求及其捕获头。
       * @returns 满足上述请求或操作条件时返回true。
       * @throws 不适用。
       */
      (call) => call.url === '/api/fs/remove',
    );
    expect(
      remove.map(
        /** 提取删除请求路径与名称。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 用于当前断言的字段。
         * @throws 不适用。
         */
        (call) => call.json,
      ),
    ).toEqual([
      { dir: '/target', names: ['new.txt'] },
      { dir: '/target/extra/nested', names: ['old.txt'] },
      { dir: '/target/extra', names: ['nested'] },
      { dir: '/target', names: ['extra'] },
    ]);
  });
  /** 源读取失败必须保留旧目标并收尾held delete。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('never deletes the old file when source preparation fails', async () => {
    f.files.set('/target/new.txt', Buffer.from('old'));
    f.fault =
      /** 使源下载返回503以验证旧目标保持不变。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws 不适用。
       */
      (call, response) =>
        call.url.startsWith('/d/') ? { status: 503, body: '' } : response;
    const run = await terminal(
      f,
      f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: true }).id,
    );
    expect(f.files.get('/target/new.txt')).toEqual(Buffer.from('old'));
    expect(
      f.server.calls.some(
        /** 识别源准备失败后禁止发生的删除。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) => call.url === '/api/fs/remove',
      ),
    ).toBe(false);
    expect(
      plan(f, run.id).map(
        /** 提取删除和创建的最终状态。
         * @param op 当前操作视图。
         * @returns 用于当前断言的字段。
         * @throws 不适用。
         */
        (op) => op.status,
      ),
    ).toEqual(['skipped', 'failed']);
  });
  /** 真实空文件必须先完成GET的EOF，才发送普通put。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('uses synchronous empty put and creates a missing target root', async () => {
    f.files.set('/source/new.txt', Buffer.alloc(0));
    f.files.delete('/target');
    const run = await terminal(
      f,
      f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: false }).id,
    );
    expect(run.status).toBe('succeeded');
    expect(f.files.get('/target/new.txt')).toEqual(Buffer.alloc(0));
    expect(
      f.server.calls.some(
        /** 识别空文件路径不应发生的init。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) => call.url === '/api/fs/multipart/init',
      ),
    ).toBe(false);
    expect(
      f.server.calls.some(
        /** 识别显式As-Task:false的空put。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) =>
          call.url === '/api/fs/put' && call.headers['as-task'] === 'false',
      ),
    ).toBe(true);
  });
  /** 明确500只观察一次，已生效mkdir不会误记unknown。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('observes mkdir after a JSON 500 and still confirms the newly created root', async () => {
    f.files.delete('/target');
    f.fault =
      /** 保留mkdir副作用但返回500以触发观察。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws 不适用。
       */
      (call, response) =>
        call.url === '/api/fs/mkdir' ? envelope(null, 500) : response;
    const run = await terminal(
      f,
      f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: false }).id,
    );
    expect(run.status).toBe('succeeded');
    expect(plan(f, run.id)[0]).toMatchObject({
      status: 'succeeded',
      error: { code: 'OBSERVED_AFTER_ERROR' },
    });
  });
  /** complete响应丢失且session被移除不能按文件大小推断成功。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('keeps complete response loss unknown even when the target already contains all bytes', async () => {
    f.fault =
      /** 丢弃complete成功响应以验证缺失session不能证明成功。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws 不适用。
       */
      (call, response) =>
        call.url.endsWith('/multipart/complete')
          ? { disconnect: true }
          : response;
    const run = await terminal(
      f,
      f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: false }).id,
    );
    expect(run.stats.unknownOperations).toBe(1);
    expect(f.files.get('/target/new.txt')).toEqual(
      f.files.get('/source/new.txt'),
    );
  });
});
