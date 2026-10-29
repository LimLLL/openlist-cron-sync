// 验证copy重试清理的源准备和目标复查失败均不会提交删除。
import { copyFixture } from './copy-fixture.js';
import type { CopyFixture } from './copy-fixture.js';
import { listing, plan, terminal } from './m2-fixture.js';
import { envelope } from './openlist-fixture.js';
import { object } from '../src/openlist/errors.js';

/** 注册重试清理的异常分类回归。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M6 retry cleanup preparation', () => {
  let f: CopyFixture;
  /** 允许一次copy重试，但让执行前403不再生成新尝试。
   * @param 不适用。
   * @returns 夹具就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await copyFixture({ RETRY_MAX_ATTEMPTS: '2', RETRY_BASE_MS: '100' });
    f.initialState = 7;
  });
  /** 清理测试自己的资源。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    await f.close();
  });
  /** 失败归属决定create分类，所有未提交cleanup都必须收尾。
   * @param failure 源缺失、源不可读或目标不可读。
   * @param expectedStatus create最终状态。
   * @param expectedCode create结果码。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it.each([
    ['source_missing', 'skipped', 'SOURCE_CHANGED'],
    ['source_unreadable', 'failed', 'OPENLIST_ERROR'],
    ['target_unreadable', 'skipped', 'PRECONDITION_UNVERIFIED'],
  ])(
    'classifies %s before cleanup',
    async (failure, expectedStatus, expectedCode) => {
      f.fault =
        /** 首个失败task遗留部分文件，在重试的强制刷新时注入故障。
         * @param call 实际HTTP请求。
         * @param response 默认协议响应。
         * @returns 本例故障或默认响应。
         * @throws Error 请求结构损坏。
         */
        (call, response) => {
          if (call.url === '/api/fs/copy' && f.copyCount === 1) {
            f.files.set('/target/new.txt', Buffer.from('part'));
            f.initialState = 2;
          }
          if (call.url !== '/api/fs/list' || f.copyCount === 0) return response;
          const body = object(call.json);
          if (body.refresh !== true) return response;
          if (body.path === '/source' && failure === 'source_missing')
            return listing();
          if (
            (body.path === '/source' && failure === 'source_unreadable') ||
            (body.path === '/target' && failure === 'target_unreadable')
          )
            return envelope(null, 403);
          return response;
        };
      const run = await terminal(
        f,
        f.runs().trigger(f.copyJob().id, {
          dryRun: false,
          confirmDeletes: true,
        }).id,
      );
      const rows = plan(f, run.id);
      const creates = rows.filter(
        /** 区分create尝试与cleanup删除。
         * @param row 操作视图。
         * @returns 是否create。
         * @throws 不适用。
         */
        (row) => row.action === 'create',
      );
      expect(creates).toHaveLength(1);
      expect(creates[0].attempts).toHaveLength(2);
      expect(creates[0]).toMatchObject({
        status: expectedStatus,
        error: { code: expectedCode },
      });
      for (const row of rows)
        if (row.reason === 'retry_cleanup') {
          expect(row.status).toBe('skipped');
          expect(row.submittedAt).toBeNull();
        }
      expect(f.copyCount).toBe(1);
      expect(f.files.get('/target/new.txt')).toEqual(Buffer.from('part'));
      expect(
        f.server.calls.some(
          /** 未通过准备条件不得提交remove。
           * @param call 捕获的请求。
           * @returns 是否删除请求。
           * @throws 不适用。
           */
          (call) => call.url === '/api/fs/remove',
        ),
      ).toBe(false);
    },
  );
});
