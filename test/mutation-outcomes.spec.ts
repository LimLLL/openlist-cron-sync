// 通过真实HTTP副作用验证统一变更分类器，防止错误响应被当成安全重传。
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { terminal, plan, listing } from './m2-fixture.js';
import { envelope, file } from './openlist-fixture.js';
import { object } from '../src/openlist/errors.js';

/** 注册错误后的刷新观察和源读取边界。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M3 mutation observation', () => {
  let f: RelayFixture;
  /** 只允许一个attempt，避免结果被重试掩盖。
   * @param 不适用。
   * @returns 独立夹具就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await relayFixture();
  });
  /** 退出全部工作并清理自有资源。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    vi.restoreAllMocks();
    await f.close();
  });
  /** 同一500必须依观察事实分类，不能直接重试或把所有情形视为unknown。
   * @param state 删除后refresh所见状态。
   * @param expected 规范操作终态。
   * @returns 观察分类验证。
   * @throws Error 断言失败。
   */
  it.each([
    ['absent', 'succeeded'],
    ['same', 'failed'],
    ['changed', 'unknown'],
    ['unreadable', 'unknown'],
  ] as const)(
    'classifies remove 500 with %s as %s',
    async (state, expected) => {
      f.files.set('/target/new.txt', Buffer.from('old'));
      let removed = false;
      f.fault =
        /** remove副作用后改变可观察结果，读取失败只发生在确认阶段。
         * @param call 当前请求。
         * @param response 默认响应。
         * @returns 当前故障窗口的响应。
         * @throws Error 列表请求JSON非法。
         */
        (call, response) => {
          if (call.url === '/api/fs/remove') {
            removed = true;
            if (state === 'same' || state === 'changed')
              f.files.set(
                '/target/new.txt',
                Buffer.from(state === 'same' ? 'old' : 'changed size'),
              );
            return envelope(null, 500);
          }
          if (
            removed &&
            state === 'unreadable' &&
            call.url === '/api/fs/list' &&
            object(call.json).path === '/target'
          )
            return envelope(null, 500);
          return response;
        };
      const run = await terminal(
        f,
        f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: true })
          .id,
      );
      const actions = plan(f, run.id);
      expect(actions[0].status).toBe(expected);
      expect(actions[1].status).toBe(
        state === 'absent' ? 'succeeded' : 'skipped',
      );
      if (state === 'absent')
        expect(actions[0].error?.code).toBe('OBSERVED_AFTER_ERROR');
    },
  );
  /** 零字节put错误也使用同一观察规则。
   * @param state put之后同名路径的实际结果。
   * @param expected 规范操作终态。
   * @returns 观察分类验证。
   * @throws Error 断言失败。
   */
  it.each([
    ['empty', 'succeeded'],
    ['absent', 'failed'],
    ['different', 'unknown'],
  ] as const)(
    'classifies empty put 500 with %s as %s',
    async (state, expected) => {
      f.files.set('/source/new.txt', Buffer.alloc(0));
      f.fault =
        /** 修改空put之后的目标事实，再返回有效错误envelope。
         * @param call 当前请求。
         * @param response 默认响应。
         * @returns put的500或其它请求的原响应。
         * @throws 不适用。
         */
        (call, response) => {
          if (call.url !== '/api/fs/put') return response;
          if (state === 'absent') f.files.delete('/target/new.txt');
          if (state === 'different')
            f.files.set('/target/new.txt', Buffer.from('not empty'));
          return envelope(null, 500);
        };
      const run = await terminal(
        f,
        f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: false })
          .id,
      );
      expect(plan(f, run.id)[0].status).toBe(expected);
    },
  );
  /** 空源实际非空、短流与编码变换必须在旧目标删除前发现。
   * @param mode 源协议违约类型。
   * @param code 规范失败原因。
   * @returns 源前提保护验证。
   * @throws Error 断言失败。
   */
  it.each([
    ['nonempty-zero', 'SIZE_MISMATCH'],
    ['short', 'SIZE_MISMATCH'],
    ['encoded', 'UPSTREAM_PROTOCOL_ERROR'],
  ] as const)(
    'rejects %s source before removing the old file',
    async (mode, code) => {
      if (mode === 'nonempty-zero')
        f.files.set('/source/new.txt', Buffer.alloc(0));
      f.files.set('/target/new.txt', Buffer.from('old'));
      f.fault =
        /** 提供无Content-Length短流、意外非空body或不允许的编码。
         * @param call 当前请求。
         * @param response 默认响应。
         * @returns 下载边界响应或原响应。
         * @throws 不适用。
         */
        (call, response) =>
          call.url.startsWith('/d/')
            ? {
                body: Buffer.from('x'),
                headers: {
                  'content-type': 'application/octet-stream',
                  ...(mode === 'encoded' ? { 'content-encoding': 'gzip' } : {}),
                },
              }
            : response;
      const run = await terminal(
        f,
        f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: true })
          .id,
      );
      expect(plan(f, run.id)[1]).toMatchObject({
        status: 'failed',
        error: { code },
      });
      expect(f.files.get('/target/new.txt')).toEqual(Buffer.from('old'));
    },
  );
  /** /d自身401只重新读取一次sign，不能触发无限登录或重试。
   * @param repeated 新sign是否仍被上游拒绝。
   * @returns 签名重新读取及提交保护验证。
   * @throws Error 断言失败。
   */
  it.each([false, true])(
    'refreshes a rejected download sign once, repeated=%s',
    async (repeated) => {
      let downloads = 0;
      let relists = 0;
      f.fault =
        /** 第一次下载返回401，随后列表提供新签名。
         * @param call 当前请求。
         * @param response 正常响应。
         * @returns 签名错误、更新后的列表或正常响应。
         * @throws Error 测试请求JSON非法或签名断言失败。
         */
        (call, response) => {
          if (call.url.startsWith('/d/')) {
            downloads++;
            if (downloads === 1 || repeated) return { status: 401, body: '' };
            expect(
              new URL(call.url, 'http://fixture').searchParams.get('sign'),
            ).toBe('renewed');
          }
          if (
            downloads &&
            call.url === '/api/fs/list' &&
            object(call.json).path === '/source'
          ) {
            relists++;
            return listing({ ...file('new.txt'), sign: 'renewed' });
          }
          return response;
        };
      const run = await terminal(
        f,
        f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: false })
          .id,
      );
      expect(run.status).toBe(repeated ? 'failed' : 'succeeded');
      expect(downloads).toBe(2);
      expect(relists).toBe(1);
    },
  );
  /** remove成功但对象仍存在时，确认超时不能开放后续create。
   * @param 不适用。
   * @returns 删除效果及依赖保护验证。
   * @throws Error 断言失败。
   */
  it('stops replacement with DELETE_NOT_EFFECTIVE after bounded confirmation', async () => {
    f.files.set('/target/new.txt', Buffer.from('old'));
    let removed = false;
    const now = Date.now();
    f.fault =
      /** 模拟删除无效，并仅在确认读开始后推进业务时钟越过确认期限。
       * @param call 当前请求。
       * @param response 正常响应。
       * @returns 原协议响应。
       * @throws Error 测试请求JSON非法。
       */
      (call, response) => {
        if (call.url === '/api/fs/remove') {
          removed = true;
          f.files.set('/target/new.txt', Buffer.from('old'));
        } else if (
          removed &&
          call.url === '/api/fs/list' &&
          object(call.json).path === '/target'
        ) {
          vi.spyOn(Date, 'now').mockReturnValue(now + 65000);
        }
        return response;
      };
    const run = await terminal(
      f,
      f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: true }).id,
    );
    const actions = plan(f, run.id);
    expect(actions[0]).toMatchObject({
      status: 'failed',
      error: { code: 'DELETE_NOT_EFFECTIVE' },
    });
    expect(actions[1].status).toBe('skipped');
    expect(f.files.get('/target/new.txt')).toEqual(Buffer.from('old'));
  });
});
