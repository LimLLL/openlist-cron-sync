// 用真实 HTTP 门闩验证人工恢复与迟到 401 共享同一次认证结果。
import { InstancesService } from '../src/instances/instances.service.js';
import { InstanceOperations } from '../src/instances/instance-operations.service.js';
import { componentFixture, envelope, latch } from './openlist-fixture.js';
import type { ComponentFixture } from './openlist-fixture.js';

/** 注册认证恢复的并发边界。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M1 authentication recovery races', () => {
  let fixture: ComponentFixture;

  /** 关闭本用例的应用、数据库和 F1 服务。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 资源关闭失败。
   */
  afterEach(async () => {
    if (fixture) await fixture.close();
  });

  /** 人工测试或相同地址的配置更新不能使旧请求持有另一套恢复状态。
   * @param mode 重建认证缓存的入口。
   * @returns 断言完成。
   * @throws Error 请求或断言失败。
   */
  it.each(['manual', 'patch', 'credentials'])(
    'reuses the current login after %s when an earlier request returns a late 401',
    async (mode) => {
      fixture = await componentFixture();
      await fixture.client.auth.account(fixture.record());
      const receivedOld = latch();
      const releaseOld = latch();
      let logins = 0;
      fixture.server.responder =
        /** 暂停旧 token 的响应，允许人工登录和身份核对先完成。
         * @param call 实际 HTTP 请求。
         * @returns 可控响应或默认成功响应。
         * @throws 不适用。
         */
        async (call) => {
          if (call.url === '/api/auth/login/hash') {
            logins++;
            return envelope({ token: 'renewed-token' });
          }
          if (
            call.url === '/api/fs/list' &&
            call.headers.authorization === 'jwt-in-memory'
          ) {
            receivedOld.release();
            await releaseOld.promise;
            return envelope(null, 401);
          }
          return undefined;
        };
      const pending = Promise.allSettled([
        fixture.client.list(fixture.record(), '/'),
      ]);
      try {
        await receivedOld.promise;
        if (mode === 'manual') {
          const result = await fixture.app
            .get(InstanceOperations)
            .test(fixture.id, { retryAuth: true });
          expect(result.error).toBeNull();
        } else {
          fixture.app.get(InstancesService).patch(
            fixture.id,
            mode === 'patch'
              ? { baseUrl: fixture.server.baseUrl }
              : {
                  auth: {
                    mode: 'password',
                    username: 'admin',
                    secret: 'updated-password',
                  },
                },
          );
          await fixture.client.auth.account(fixture.record());
        }
      } finally {
        releaseOld.release();
        await pending;
      }
      expect(await pending).toMatchObject(
        mode === 'credentials'
          ? [{ status: 'rejected', reason: { code: 'INVALID_STATE' } }]
          : [{ status: 'fulfilled' }],
      );
      expect(logins).toBe(1);
    },
  );

  /** 上游同一秒签发的 JWT 可相同，迟到响应仍属于旧认证过程。
   * @param 不适用。
   * @returns 断言完成。
   * @throws Error 请求或断言失败。
   */
  it('coalesces late 401 responses even if relogin returns identical token bytes', async () => {
    fixture = await componentFixture();
    await fixture.client.auth.account(fixture.record());
    const allOld = latch();
    const replayed = latch();
    let reads = 0;
    let logins = 0;
    fixture.server.responder =
      /** 两个旧请求均已发出后拒绝，第二个 401 等到新登录已被使用再返回。
       * @param call 实际 HTTP 请求。
       * @returns 认证拒绝或默认成功响应。
       * @throws 不适用。
       */
      async (call) => {
        if (call.url === '/api/auth/login/hash') {
          logins++;
          return envelope({ token: 'jwt-in-memory' });
        }
        if (call.url !== '/api/fs/list') return undefined;
        const sequence = ++reads;
        if (sequence > 2) {
          replayed.release();
          return undefined;
        }
        if (sequence === 2) allOld.release();
        await allOld.promise;
        if (sequence === 2) await replayed.promise;
        return envelope(null, 401);
      };
    const results = await Promise.all([
      fixture.client.list(fixture.record(), '/'),
      fixture.client.list(fixture.record(), '/'),
    ]);
    expect(results).toHaveLength(2);
    expect(reads).toBe(4);
    expect(logins).toBe(1);
  });
  /** 已接受的旧 /me 响应不能解除之后确认的密码阻断。
   * @param 不适用。
   * @returns 断言完成。
   * @throws Error 请求或断言失败。
   */
  it('keeps a manual credential block when an older successful me arrives later', async () => {
    fixture = await componentFixture();
    await fixture.client.auth.account(fixture.record());
    const receivedMe = latch();
    const releaseMe = latch();
    fixture.server.responder =
      /** 让旧身份响应晚于人工登录失败返回。
       * @param call 实际 HTTP 请求。
       * @returns 拒绝或默认身份响应。
       * @throws 不适用。
       */
      async (call) => {
        if (call.url === '/api/me') {
          receivedMe.release();
          await releaseMe.promise;
          return undefined;
        }
        if (call.url === '/api/auth/login/hash') return envelope(null, 401);
        return undefined;
      };
    const pending = Promise.allSettled([
      fixture.client.auth.account(fixture.record(), true),
    ]);
    try {
      await receivedMe.promise;
      const result = await fixture.app
        .get(InstanceOperations)
        .test(fixture.id, { retryAuth: true });
      expect(result.error?.code).toBe('AUTH_BLOCKED');
    } finally {
      releaseMe.release();
      await pending;
    }
    expect(fixture.record()).toMatchObject({
      authState: 'auth_blocked',
      authBlockReason: 'LOGIN_401',
    });
    expect(await pending).toMatchObject([
      { status: 'rejected', reason: { code: 'AUTH_BLOCKED' } },
    ]);
  });
});
