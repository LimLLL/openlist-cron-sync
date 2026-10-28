// 稳定制造写入失败窗口，验证结果证据、删除保护和重试收敛。
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { terminal, plan } from './m2-fixture.js';
import { envelope } from './openlist-fixture.js';
import { object } from '../src/openlist/errors.js';

/** 注册失败证据行为，不以代码实现细节替代远端副作用断言。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M3 mutation and relay failure windows', () => {
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
  /** 同一chunk丢响应后，status证明已接收则不重复上传。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('uses status evidence after chunk response loss without duplicating payload', async () => {
    let lost = false;
    f.fault =
      /** 仅丢弃首个chunk响应，保留服务器接收事实。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws 不适用。
       */
      (call, response) => {
        if (call.url.endsWith('/chunk') && !lost) {
          lost = true;
          return { disconnect: true };
        }
        return response;
      };
    const result = await run();
    expect(result.status).toBe('succeeded');
    expect(
      f.server.calls.filter(
        /** 筛选chunk请求以核对不重复发送。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) => call.url.endsWith('/chunk'),
      ),
    ).toHaveLength(1);
    expect(result.stats.retryAttempts).toBe(0);
  });
  /** 有效错误envelope内的失败session不能丢失；新attempt清理残留后成功。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('preserves failure snapshots, cleans residue and unblocks mirror after a successful retry', async () => {
    f.files.set('/target/extra.txt', Buffer.from('extra'));
    let failed = false;
    f.fault =
      /** 在首个chunk错误envelope中返回failed_retriable证据。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws Error 测试协议数据非法。
       */
      (call, response) => {
        if (call.url.endsWith('/chunk') && !failed) {
          failed = true;
          return envelope(
            {
              ...object(object(response.body).data),
              state: 'failed_retriable',
            },
            500,
          );
        }
        return response;
      };
    const result = await run(
      { targets: [{ instanceId: f.id, path: '/target', mode: 'mirror' }] },
      true,
    );
    expect(
      result.status,
      JSON.stringify({
        stats: result.stats,
        reasons: result.targets[0].blockReasons,
        operations: plan(f, result.id).map(
          /** 投影重试链诊断字段以帮助定位断言失败。
           * @param op 当前操作视图。
           * @returns 用于当前断言的字段。
           * @throws 不适用。
           */
          (op) => ({
            action: op.action,
            reason: op.reason,
            status: op.status,
            retryOf: op.retryOf,
            error: op.error,
          }),
        ),
      }),
    ).toBe('succeeded');
    expect(result.stats).toMatchObject({
      retryAttempts: 1,
      failedOperations: 0,
      succeededCreates: 1,
      deletedAsExtra: 1,
    });
    expect(result.targets[0].extrasBlocked).toBe(false);
    const actions = plan(f, result.id);
    expect(
      actions.find(
        /** 取得新attempt产生的retry_cleanup动作。
         * @param op 当前操作视图。
         * @returns 用于当前断言的字段。
         * @throws 不适用。
         */
        (op) => op.reason === 'retry_cleanup',
      )?.status,
    ).toBe('succeeded');
    expect(
      actions
        .filter(
          /** 筛选create尝试以核对重试历史。
           * @param op 当前操作视图。
           * @returns 满足上述请求或操作条件时返回true。
           * @throws 不适用。
           */
          (op) => op.action === 'create',
        )
        .map(
          /** 提取各次尝试的最终状态。
           * @param op 当前操作视图。
           * @returns 用于当前断言的字段。
           * @throws 不适用。
           */
          (op) => op.status,
        ),
    ).toEqual(['failed', 'succeeded']);
    expect(
      f.server.calls
        .filter(
          /** 筛选新session提交请求。
           * @param call 真实HTTP请求及其捕获头。
           * @returns 满足上述请求或操作条件时返回true。
           * @throws 不适用。
           */
          (call) => call.url.endsWith('/init'),
        )
        .every(
          /** 验证每次init都明确禁止覆盖。
           * @param call 真实HTTP请求及其捕获头。
           * @returns 满足上述请求或操作条件时返回true。
           * @throws 不适用。
           */
          (call) => call.headers.overwrite === 'false',
        ),
    ).toBe(true);
  });
  /** 计划R已经预留预算，不能免费清理重试残留。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('blocks retry cleanup when the remaining deletion budget is zero', async () => {
    f.fault =
      /** 返回可重试失败以耗尽剩余删除预算。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws Error 测试协议数据非法。
       */
      (call, response) =>
        call.url.endsWith('/chunk')
          ? envelope(
              {
                ...object(object(response.body).data),
                state: 'failed_retriable',
              },
              500,
            )
          : response;
    const result = await run();
    expect(
      plan(f, result.id).some(
        /** 识别cleanup被DELETE_LIMIT阻断。
         * @param op 当前操作视图。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (op) => op.error?.code === 'DELETE_LIMIT',
      ),
    ).toBe(true);
    expect(
      f.server.calls.filter(
        /** 筛选init以核对预算用尽后未再次提交。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) => call.url.endsWith('/init'),
      ),
    ).toHaveLength(1);
    expect(
      f.server.calls.some(
        /** 识别预算用尽后禁止发生的删除。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) => call.url === '/api/fs/remove',
      ),
    ).toBe(false);
  });
  /** 流控只退避，不能耗掉文件级attempt。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('handles 429 and 409 within the same session', async () => {
    let chunks = 0;
    f.fault =
      /** 连续模拟429与409而不改变session身份。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws 不适用。
       */
      (call, response) =>
        call.url.endsWith('/chunk') && ++chunks <= 2
          ? envelope(null, chunks === 1 ? 429 : 409)
          : response;
    const result = await run();
    expect(result.status).toBe('succeeded');
    expect(result.stats.retryAttempts).toBe(0);
    expect(
      f.server.calls.filter(
        /** 筛选init以核对流控没有新建attempt。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) => call.url.endsWith('/init'),
      ),
    ).toHaveLength(1);
  });
  /** 超长源在最后chunk之前被发现，旧文件不回滚且extras不能继续。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('aborts oversized source before sending the final chunk', async () => {
    f.files.set('/source/new.txt', Buffer.alloc(1048576 + 17, 17));
    f.files.set('/target/new.txt', Buffer.from('old'));
    f.fault =
      /** 提供比计划多一个字节的源响应。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws 不适用。
       */
      (call, response) =>
        call.url.startsWith('/d/')
          ? {
              body: Buffer.alloc(1048576 + 18, 17),
              headers: { 'content-type': 'application/octet-stream' },
            }
          : response;
    const result = await run({}, true);
    expect(result.status).toBe('partial');
    expect(
      plan(f, result.id).find(
        /** 取得源异常对应的create动作。
         * @param op 当前操作视图。
         * @returns 用于当前断言的字段。
         * @throws 不适用。
         */
        (op) => op.action === 'create',
      ),
    ).toMatchObject({ status: 'failed', error: { code: 'SIZE_MISMATCH' } });
    expect(
      f.server.calls.some(
        /** 识别源未通过EOF检查时禁止发生的complete。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) => call.url.endsWith('/complete'),
      ),
    ).toBe(false);
    expect(
      f.server.calls
        .filter(
          /** 筛选分片请求以检查最后chunk门槛。
           * @param call 真实HTTP请求及其捕获头。
           * @returns 满足上述请求或操作条件时返回true。
           * @throws 不适用。
           */
          (call) => call.url.endsWith('/chunk'),
        )
        .every(
          /** 验证超长源只发送了第一个chunk。
           * @param call 真实HTTP请求及其捕获头。
           * @returns 满足上述请求或操作条件时返回true。
           * @throws 不适用。
           */
          (call) => call.headers['x-chunk-index'] === '0',
        ),
    ).toBe(true);
  });
  /** 空put的非符合协议任务只记unknown，不伪装成server_copy记录。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('records an unexpected zero-byte put task as unknown without saving a tid', async () => {
    f.files.set('/source/new.txt', Buffer.alloc(0));
    f.fault =
      /** 在同步空put后返回意外task以检验unknown记录。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws 不适用。
       */
      (call, response) =>
        call.url === '/api/fs/put'
          ? envelope({
              task: {
                id: 'anomalous',
                name: 'private',
                state: 0,
                status: '',
                progress: 0,
                error: '',
                start_time: null,
                end_time: null,
                total_bytes: 0,
              },
            })
          : response;
    const result = await run();
    expect(plan(f, result.id)[0]).toMatchObject({
      status: 'unknown',
      task: null,
      error: { code: 'UPSTREAM_PROTOCOL_ERROR' },
    });
    expect(
      f.server.calls.some(
        /** 识别本阶段禁止启动的上传task跟踪。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) => call.url.startsWith('/api/task/'),
      ),
    ).toBe(false);
  });
});
