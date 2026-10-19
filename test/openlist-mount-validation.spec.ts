// 验证无效挂载路径不会被默认成根存储。
import { componentFixture, envelope, storage } from './openlist-fixture.js';

/** 注册管理员挂载映射的无效路径边界。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M1 mount path validation', () => {
  /** 空或非绝对路径不能成为可信的根挂载。
   * @param mountPath 上游无效挂载路径。
   * @returns 断言完成。
   * @throws Error 请求、清理或断言失败。
   */
  it.each(['', '.balance1'])(
    'rejects invalid mount_path %j after one bounded reread',
    async (mountPath) => {
      const fixture = await componentFixture('token');
      let pages = 0;
      try {
        fixture.server.responder =
          /** 返回完整分页但携带无效挂载，不能静默解释为根路径。
           * @param call 实际 HTTP 请求。
           * @returns 异常存储页或默认响应。
           * @throws 不适用。
           */
          (call) => {
            if (!call.url.startsWith('/api/admin/storage/list'))
              return undefined;
            pages++;
            return envelope({ content: [storage(1, mountPath)], total: 1 });
          };
        await expect(
          fixture.client.storages(fixture.record()),
        ).rejects.toMatchObject({ code: 'MOUNT_BOUNDARY_UNKNOWN' });
        expect(pages).toBe(2);
      } finally {
        await fixture.close();
      }
    },
  );
});
