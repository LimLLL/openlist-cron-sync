// 验证停止派发后已派发动作在宽限内收尾，不把已确认的删除误记为unknown。
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { terminal, plan } from './m2-fixture.js';
import { latch } from './openlist-fixture.js';
import type { CapturedCall, Reply } from './openlist-fixture.js';
import { object } from '../src/openlist/errors.js';

/** 注册取消与关闭时的在途收尾行为。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M3 in-flight cleanup after stop', () => {
  let f: RelayFixture | undefined;
  /** 关闭测试拥有的资源。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });
  /** 识别remove成功后的第一次确认读取。
   * @param fixture 当前夹具。
   * @param hold 收到确认读取时等待的门闩。
   * @returns F1故障函数及“已进入确认”门闩。
   * @throws 不适用。
   */
  function holdFirstConfirmation(fixture: RelayFixture, hold: Promise<void>) {
    const confirming = latch();
    let removed = false;
    let held = false;
    fixture.fault =
      /** remove之后第一次刷新目标目录时暂停响应；响应内容已按删除后的状态生成。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应。
       * @returns 原响应。
       * @throws 不适用。
       */
      async (call: CapturedCall, response: Reply): Promise<Reply> => {
        if (call.url === '/api/fs/remove') removed = true;
        else if (
          removed &&
          !held &&
          call.url === '/api/fs/list' &&
          object(call.json).path === '/target' &&
          object(call.json).refresh === true
        ) {
          held = true;
          confirming.release();
          await hold;
        }
        return response;
      };
    return confirming;
  }
  /** 取消发生在删除确认期间：确认在CANCEL_GRACE内完成并记succeeded，create不再提交。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('finishes a delete confirmation within the cancel grace instead of quarantining it', async () => {
    const fixture = await relayFixture();
    f = fixture;
    fixture.files.set('/target/new.txt', Buffer.from('old'));
    const hold = latch();
    const confirming = holdFirstConfirmation(fixture, hold.promise);
    try {
      const accepted = fixture
        .runs()
        .trigger(fixture.job().id, { dryRun: false, confirmDeletes: true });
      await confirming.promise;
      fixture.runs().cancel(accepted.id);
      hold.release();
      const result = await terminal(fixture, accepted.id);
      expect(result.status).toBe('cancelled');
      expect(result.stats.unknownOperations).toBe(0);
      expect(
        plan(fixture, result.id).map(
          /** 提取删除与创建的最终状态。
           * @param op 当前操作视图。
           * @returns 状态。
           * @throws 不适用。
           */
          (op) => op.status,
        ),
      ).toEqual(['succeeded', 'cancelled']);
      expect(
        fixture.server.calls.some(
          /** 识别取消后不应发生的init。
           * @param call 真实HTTP请求及其捕获头。
           * @returns 是否为init。
           * @throws 不适用。
           */
          (call) => call.url.endsWith('/multipart/init'),
        ),
      ).toBe(false);
    } finally {
      hold.release();
    }
  });
  /** 关闭宽限内无法确认：保持running，下次启动以确认读收敛，不写unknown。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('leaves an unconfirmed delete running at shutdown and confirms it after restart', async () => {
    const fixture = await relayFixture({ SHUTDOWN_GRACE_SECONDS: '1' });
    f = fixture;
    fixture.files.set('/target/new.txt', Buffer.from('old'));
    const hold = latch();
    const confirming = holdFirstConfirmation(fixture, hold.promise);
    try {
      const accepted = fixture
        .runs()
        .trigger(fixture.job().id, { dryRun: false, confirmDeletes: true });
      await confirming.promise;
      await fixture.restart();
      const result = await terminal(fixture, accepted.id);
      expect(result.status).toBe('interrupted');
      expect(result.stats.unknownOperations).toBe(0);
      expect(plan(fixture, result.id)).toMatchObject([
        { action: 'delete', status: 'succeeded' },
        {
          action: 'create',
          status: 'skipped',
          error: { code: 'PLAN_INTERRUPTED' },
        },
      ]);
    } finally {
      hold.release();
    }
  });
  /** 取消后才收到SIGTERM时，较短关机期限必须覆盖已启动的取消宽限。
   * @param 不适用。
   * @returns 重启确认完成且没有触发关闭watchdog。
   * @throws Error 断言或关闭失败。
   */
  it('shortens an existing cancellation grace when shutdown begins', async () => {
    const fixture = await relayFixture({
      SHUTDOWN_GRACE_SECONDS: '1',
      CANCEL_GRACE_SECONDS: '60',
    });
    f = fixture;
    fixture.files.set('/target/new.txt', Buffer.from('old'));
    const hold = latch();
    const confirming = holdFirstConfirmation(fixture, hold.promise);
    try {
      const accepted = fixture
        .runs()
        .trigger(fixture.job().id, { dryRun: false, confirmDeletes: true });
      await confirming.promise;
      fixture.runs().cancel(accepted.id);
      await fixture.restart();
      expect((await terminal(fixture, accepted.id)).status).toBe('interrupted');
      expect(plan(fixture, accepted.id)[0].status).toBe('succeeded');
    } finally {
      hold.release();
    }
  }, 10000);
  /** 取消时0字节put已派发：在CANCEL_GRACE内取得响应并记succeeded，不隔离。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('waits for an already dispatched empty put within the cancel grace', async () => {
    const fixture = await relayFixture();
    f = fixture;
    fixture.files.set('/source/new.txt', Buffer.alloc(0));
    const dispatched = latch();
    const hold = latch();
    fixture.fault =
      /** 空put副作用已发生后暂停响应，等待测试先取消Run。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应。
       * @returns 原响应。
       * @throws 不适用。
       */
      async (call: CapturedCall, response: Reply): Promise<Reply> => {
        if (call.url === '/api/fs/put') {
          dispatched.release();
          await hold.promise;
        }
        return response;
      };
    try {
      const accepted = fixture
        .runs()
        .trigger(fixture.job().id, { dryRun: false, confirmDeletes: false });
      await dispatched.promise;
      fixture.runs().cancel(accepted.id);
      hold.release();
      const result = await terminal(fixture, accepted.id);
      expect(result.status).toBe('cancelled');
      expect(result.stats.unknownOperations).toBe(0);
      expect(plan(fixture, result.id)[0]).toMatchObject({
        action: 'create',
        status: 'succeeded',
      });
    } finally {
      hold.release();
    }
  });
});
