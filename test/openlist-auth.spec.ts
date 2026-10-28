// 用真实 HTTP 与 SQLite 验证 single-flight、持久阻断和冷却边界。
import { createHash } from 'node:crypto';
import { InstanceOperations } from '../src/instances/instance-operations.service.js';
import { InstancesService } from '../src/instances/instances.service.js';
import { OpenListMultipart } from '../src/openlist/multipart.service.js';
import { componentFixture, envelope, latch } from './openlist-fixture.js';
import type { ComponentFixture } from './openlist-fixture.js';

describe('M1 authentication' /** 注册本组 M1 行为验收用例。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */, () => {
  let fixture: ComponentFixture;
  afterEach(
    /** 恢复测试状态并释放本用例拥有的资源。
     * @param 不适用。
     * @returns 清理完成；异步资源返回 Promise。
     * @throws Error 资源清理失败。
     */
    async () => {
      vi.restoreAllMocks();
      if (fixture) await fixture.close();
    },
  );

  it('coalesces concurrent and late stale-token 401 into exactly one login' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    fixture = await componentFixture();
    await fixture.client.auth.account(fixture.record());
    const allOld = latch();
    const newRead = latch();
    let rejected = 0;
    let logins = 0;
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      async (call) => {
        if (call.url === '/api/auth/login/hash') {
          logins++;
          return envelope({ token: 'new-token' });
        }
        if (call.url !== '/api/fs/list') return;
        if (call.headers.authorization === 'new-token') {
          newRead.release();
          return;
        }
        rejected++;
        const late = rejected === 4;
        if (late) allOld.release();
        await allOld.promise;
        if (late) await newRead.promise;
        return envelope(null, 401);
      };
    await Promise.all(
      Array.from(
        { length: 4 },

        /** 执行一个真实客户端调用以验证并发或错误行为。
         * @param 不适用。
         * @returns 上游调用的 Promise。
         * @throws OpenListError 预期的上游拒绝或协议失败。
         */
        () => fixture.client.list(fixture.record(), '/'),
      ),
    );
    expect(logins).toBe(1);
    expect(rejected).toBe(4);
    const login = fixture.server.calls.find(
      /** 筛选所需端点的实际 HTTP 请求。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 是否匹配该协议端点。
       * @throws 不适用。
       */
      (call) => call.url === '/api/auth/login/hash',
    );
    expect(login?.json).toEqual({
      username: 'admin',
      password: createHash('sha256')
        .update('openlist-password-https://github.com/alist-org/alist')
        .digest('hex'),
    });
  });

  it.each([401, 402])(
    'persists login %i across restart and permits one explicit retry',

    /** 验证当前场景的协议输入、输出与副作用。
     * @param status 上游拒绝状态码。
     * @returns 断言完成；异步用例返回完成 Promise。
     * @throws Error 断言或测试资源操作失败。
     */
    async (status) => {
      fixture = await componentFixture();
      fixture.server.responder =
        /** 根据请求端点返回本场景的可控上游响应。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 故障响应或 undefined 以使用默认响应。
         * @throws 不适用。
         */
        (call) =>
          call.url === '/api/auth/login/hash'
            ? envelope({ password: 'LEAK' }, status)
            : undefined;
      await expect(
        fixture.client.list(fixture.record(), '/'),
      ).rejects.toMatchObject({ code: 'AUTH_BLOCKED' });
      expect(fixture.record()).toMatchObject({
        authState: 'auth_blocked',
        authBlockReason: `LOGIN_${status}`,
        authBlockedUntil: null,
      });
      await fixture.restart();
      await expect(
        fixture.client.list(fixture.record(), '/'),
      ).rejects.toMatchObject({ code: 'AUTH_BLOCKED' });
      expect(fixture.server.calls).toHaveLength(1);
      const operations = fixture.app.get(InstanceOperations);
      const result = await operations.test(fixture.id, { retryAuth: true });
      expect(result.error?.code).toBe('AUTH_BLOCKED');
      expect(fixture.server.calls).toHaveLength(2);
      expect(JSON.stringify(result)).not.toContain('LEAK');
      // 人工尝试遇到网络失败时不能解除阻断，否则之后的自动调用会再次登录。
      fixture.server.responder =
        /** 让登录请求断开连接。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 断连响应或 undefined 以使用默认响应。
         * @throws 不适用。
         */
        (call) =>
          call.url === '/api/auth/login/hash'
            ? { disconnect: true }
            : undefined;
      const offline = await operations.test(fixture.id, { retryAuth: true });
      expect(offline.error?.code).toBe('OPENLIST_ERROR');
      expect(fixture.record()).toMatchObject({
        authState: 'auth_blocked',
        authBlockReason: `LOGIN_${status}`,
      });
      await expect(
        fixture.client.list(fixture.record(), '/'),
      ).rejects.toMatchObject({ code: 'AUTH_BLOCKED' });
      expect(fixture.server.calls).toHaveLength(3);
      fixture.server.responder = undefined;
      const recovered = await operations.test(fixture.id, { retryAuth: true });
      expect(recovered.error).toBeNull();
      expect(fixture.record()).toMatchObject({
        authState: 'ready',
        authBlockReason: null,
      });
    },
  );

  it('never probes or extends a 429 cooldown, including after restart' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    fixture = await componentFixture();
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) =>
        call.url === '/api/auth/login/hash' ? envelope(null, 429) : undefined;
    await expect(
      fixture.client.list(fixture.record(), '/'),
    ).rejects.toMatchObject({ code: 'AUTH_BLOCKED' });
    const until = fixture.record().authBlockedUntil;
    expect(until).not.toBeNull();
    await fixture.restart();
    await Promise.all(
      Array.from(
        { length: 5 },

        /** 执行一个真实客户端调用以验证并发或错误行为。
         * @param 不适用。
         * @returns 上游调用的 Promise。
         * @throws OpenListError 预期的上游拒绝或协议失败。
         */
        () =>
          expect(
            fixture.client.list(fixture.record(), '/'),
          ).rejects.toMatchObject({ code: 'AUTH_BLOCKED' }),
      ),
    );
    await expect(
      fixture.app.get(InstanceOperations).test(fixture.id, { retryAuth: true }),
    ).rejects.toMatchObject({ code: 'AUTH_COOLDOWN' });
    await expect(
      fixture.client.settings(fixture.record()),
    ).rejects.toMatchObject({ code: 'AUTH_BLOCKED' });
    expect(fixture.record().authBlockedUntil).toBe(until);
    expect(fixture.server.calls).toHaveLength(1);
    if (until === null) throw new Error('Missing cooldown');
    const now = Date.now.bind(Date);
    const offset = until + 1 - now();
    vi.spyOn(Date, 'now').mockImplementation(
      /** 推进认证墙钟，同时保持实际时间流动。
       * @param 不适用。
       * @returns 冷却结束后的毫秒时间。
       * @throws 不适用。
       */
      () => now() + offset,
    );
    fixture.server.responder = undefined;
    await fixture.client.list(fixture.record(), '/');
    expect(fixture.record().authState).toBe('ready');
    expect(
      fixture.server.calls.filter(
        /** 筛选所需端点的实际 HTTP 请求。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 是否匹配该协议端点。
         * @throws 不适用。
         */
        (call) => call.url === '/api/auth/login/hash',
      ),
    ).toHaveLength(2);
  });

  it('blocks static tokens without falling back to password and rejects guest' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    fixture = await componentFixture('token');
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) => (call.url === '/api/me' ? envelope(null, 401) : undefined);
    await expect(
      fixture.client.list(fixture.record(), '/'),
    ).rejects.toMatchObject({ code: 'AUTH_BLOCKED' });
    await fixture.restart();
    await expect(
      fixture.client.list(fixture.record(), '/'),
    ).rejects.toMatchObject({ code: 'AUTH_BLOCKED' });
    expect(fixture.server.calls).toHaveLength(1);
    fixture.app
      .get(InstancesService)
      .patch(fixture.id, { auth: { mode: 'token', secret: 'guest-token' } });
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) =>
        call.url === '/api/me'
          ? envelope({
              username: 'guest',
              base_path: '/',
              role: 1,
              permission: 0,
            })
          : undefined;
    const result = await fixture.app
      .get(InstanceOperations)
      .test(fixture.id, { retryAuth: false });
    expect(result.authenticated).toBe(false);
    expect(fixture.record().authBlockReason).toBe('GUEST');
    expect(
      fixture.server.calls.some(
        /** 筛选所需端点的实际 HTTP 请求。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 是否匹配该协议端点。
         * @throws 不适用。
         */
        (call) => call.url.includes('/login'),
      ),
    ).toBe(false);
  });

  it('a login network failure is one failed call, not a credential block' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    fixture = await componentFixture();
    fixture.server.responder =
      /** 筛选所需端点的实际 HTTP 请求。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 是否匹配该协议端点。
       * @throws 不适用。
       */
      (call) =>
        call.url.includes('/login/') ? { disconnect: true } : undefined;
    await expect(
      fixture.client.list(fixture.record(), '/'),
    ).rejects.toMatchObject({ code: 'OPENLIST_ERROR' });
    expect(fixture.record().authState).toBe('untested');
    expect(fixture.server.calls).toHaveLength(1);
  });

  it('updates identity on every successful me and never persists JWT' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    fixture = await componentFixture();
    await fixture.client.auth.account(fixture.record());
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) =>
        call.url === '/api/me'
          ? envelope({
              username: 'changed',
              base_path: '/new',
              role: 0,
              permission: 9,
            })
          : undefined;
    await fixture.client.auth.account(fixture.record(), true);
    expect(fixture.record()).toMatchObject({
      accountUsername: 'changed',
      accountBasePath: '/new',
      accountRole: 0,
      accountPermissions: 9,
    });
    expect(JSON.stringify(fixture.record())).not.toContain('jwt-in-memory');
  });
  /** 路径密码拒绝不触发登录；401 的变更重新登录后重放一次，上传 body 从不重放。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言或资源失败。
   */
  it('does not relogin for path 403, replays a JSON mutation once after 401 and never an upload body', async () => {
    fixture = await componentFixture();
    await fixture.client.auth.account(fixture.record());
    let mkdirs = 0;
    fixture.server.responder =
      /** 为三种端点分别返回权限与认证拒绝。
       * @param call 上游请求。
       * @returns 响应或默认处理。
       * @throws 不适用。
       */
      (call) => {
        if (call.url === '/api/fs/list') return envelope(null, 403);
        if (call.url === '/api/fs/mkdir' && ++mkdirs === 1)
          return envelope(null, 401);
        if (call.url === '/api/fs/put') return envelope(null, 401);
        return undefined;
      };
    await expect(
      fixture.client.list(fixture.record(), '/'),
    ).rejects.toMatchObject({ upstreamCode: 403 });
    await fixture.client.mkdir(fixture.record(), '/new');
    await expect(
      fixture.app
        .get(OpenListMultipart)
        .putEmpty(
          fixture.record(),
          { directory: '/', name: 'empty' },
          { signal: AbortSignal.timeout(5000) },
        ),
    ).rejects.toMatchObject({ upstreamCode: 401 });
    expect(fixture.record().authState).toBe('ready');
    fixture.server.responder = undefined;
    await fixture.client.list(fixture.record(), '/');
    expect(
      fixture.server.calls.map(
        /** 提取请求端点以断言完整调用顺序。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 请求路径。
         * @throws 不适用。
         */
        (call) => call.url,
      ),
    ).toEqual([
      '/api/auth/login/hash',
      '/api/me',
      '/api/fs/list',
      '/api/fs/mkdir',
      '/api/auth/login/hash',
      '/api/me',
      '/api/fs/mkdir',
      '/api/fs/put',
      '/api/auth/login/hash',
      '/api/me',
      '/api/fs/list',
    ]);
  });
});
