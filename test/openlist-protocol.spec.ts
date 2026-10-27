// 用 F1 验证真实状态、受限读取、只读重试和无变更重放。
import { InstanceOperations } from '../src/instances/instance-operations.service.js';
import { OpenListMultipart } from '../src/openlist/multipart.service.js';
import { accountWarnings, supportedVersion } from '../src/openlist/protocol.js';
import { componentFixture, envelope, file } from './openlist-fixture.js';
import type { ComponentFixture } from './openlist-fixture.js';

describe('M1 protocol boundaries' /** 注册本组 M1 行为验收用例。
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

  it('fs JSON 500 remains a failed read and is never interpreted as missing' /** 验证当前场景的协议输入、输出与副作用。
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
      (call) => (call.url === '/api/fs/list' ? envelope(null, 500) : undefined);
    await expect(
      fixture.client.list(fixture.record(), '/'),
    ).rejects.toMatchObject({ code: 'OPENLIST_ERROR', upstreamCode: 500 });
    expect(
      fixture.server.calls.filter(
        /** 筛选所需端点的实际 HTTP 请求。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 是否匹配该协议端点。
         * @throws 不适用。
         */
        (call) => call.url === '/api/fs/list',
      ),
    ).toHaveLength(2);
  });

  it.each([
    {
      reply: {
        body: '<html>proxy</html>',
        headers: { 'content-type': 'text/html' },
      },
      code: 'UPSTREAM_PROTOCOL_ERROR',
    },
    {
      reply: {
        status: 502,
        body: '<html>proxy</html>',
        headers: { 'content-type': 'text/html' },
      },
      code: 'OPENLIST_ERROR',
    },
    { reply: { body: '{broken' }, code: 'UPSTREAM_PROTOCOL_ERROR' },
    {
      reply: { body: { code: 200, message: 'bad' } },
      code: 'UPSTREAM_PROTOCOL_ERROR',
    },
    {
      reply: envelope({ content: null, total: 2, write: true }),
      code: 'UPSTREAM_PROTOCOL_ERROR',
    },
    {
      reply: envelope({
        content: [{ ...file(), size: Number.MAX_SAFE_INTEGER + 1 }],
        total: 1,
        write: true,
      }),
      code: 'INVALID_SIZE',
    },
  ])(
    'rejects malformed or unsuccessful responses: $code',

    /** 验证当前场景的协议输入、输出与副作用。
     * @param input 本用例输入。
     * @returns 断言完成；异步用例返回完成 Promise。
     * @throws Error 断言或测试资源操作失败。
     */
    async ({ reply, code }) => {
      fixture = await componentFixture();
      fixture.server.responder =
        /** 根据请求端点返回本场景的可控上游响应。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 故障响应或 undefined 以使用默认响应。
         * @throws 不适用。
         */
        (call) => (call.url === '/api/fs/list' ? reply : undefined);
      await expect(
        fixture.client.list(fixture.record(), '/'),
      ).rejects.toMatchObject({ code });
    },
  );

  it('enforces actual response bytes and accepts null content only on success' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    fixture = await componentFixture('token', {
      OPENLIST_MAX_JSON_BYTES: '1024',
    });
    fixture.server.responder =
      /** 筛选所需端点的实际 HTTP 请求。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 是否匹配该协议端点。
       * @throws 不适用。
       */
      (call) =>
        call.url === '/api/fs/list' ? { body: ' '.repeat(2048) } : undefined;
    await expect(
      fixture.client.list(fixture.record(), '/'),
    ).rejects.toMatchObject({ code: 'UPSTREAM_JSON_TOO_LARGE' });
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) =>
        call.url === '/api/fs/list'
          ? envelope({ content: null, total: 0, write: false })
          : undefined;
    expect(await fixture.client.list(fixture.record(), '/')).toMatchObject({
      items: [],
      total: 0,
      write: false,
    });
  });

  it('honours Retry-After without replaying mutations or auth requests' /** 记录上游实际收到请求的时间。
   * @param 不适用。
   * @returns undefined，使用默认上游响应。
   * @throws 不适用。
   */, async () => {
    fixture = await componentFixture('password', { RETRY_MAX_MS: '1000' });
    let reads = 0;
    const times: number[] = [];
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) => {
        if (call.url === '/api/fs/list') {
          times.push(performance.now());
          reads++;
          if (reads === 1)
            return { ...envelope(null, 429), headers: { 'retry-after': '1' } };
        }
        if (call.url === '/api/fs/mkdir') return envelope(null, 500);
        return;
      };
    await fixture.client.list(fixture.record(), '/');
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(950);
    await expect(
      fixture.client.mkdir(fixture.record(), '/new'),
    ).rejects.toMatchObject({ upstreamCode: 500 });
    expect(
      fixture.server.calls.filter(
        /** 筛选所需端点的实际 HTTP 请求。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 是否匹配该协议端点。
         * @throws 不适用。
         */
        (call) => call.url === '/api/fs/mkdir',
      ),
    ).toHaveLength(1);
  });

  it('refuses all API/upload redirects and never sends Authorization to their destination' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    fixture = await componentFixture('token');
    await fixture.client.auth.account(fixture.record());
    fixture.server.responder =
      /** 验证当前场景的协议输入、输出与副作用。
       * @param 不适用。
       * @returns 断言完成；异步用例返回完成 Promise。
       * @throws Error 断言或测试资源操作失败。
       */
      () => ({
        status: 302,
        headers: { location: fixture.server.baseUrl + '/stolen' },
      });
    const instance = fixture.record();
    const uploads = fixture.app.get(OpenListMultipart);
    const calls = [
      /** 执行一个真实客户端调用以验证并发或错误行为。
       * @param 不适用。
       * @returns 上游调用的 Promise。
       * @throws OpenListError 预期的上游拒绝或协议失败。
       */
      () => fixture.client.list(instance, '/'),
      /** 执行一个真实客户端调用以验证并发或错误行为。
       * @param 不适用。
       * @returns 上游调用的 Promise。
       * @throws OpenListError 预期的上游拒绝或协议失败。
       */
      () => fixture.client.mkdir(instance, '/new'),
      /** 执行一个真实客户端调用以验证并发或错误行为。
       * @param 不适用。
       * @returns 上游调用的 Promise。
       * @throws OpenListError 预期的上游拒绝或协议失败。
       */
      () => uploads.putEmpty(instance, { directory: '/', name: 'empty' }),
      /** 执行一个真实客户端调用以验证并发或错误行为。
       * @param 不适用。
       * @returns 上游调用的 Promise。
       * @throws OpenListError 预期的上游拒绝或协议失败。
       */
      () => uploads.init(instance, { directory: '/', name: 'file' }, 1),
      /** 执行一个真实客户端调用以验证并发或错误行为。
       * @param 不适用。
       * @returns 上游调用的 Promise。
       * @throws OpenListError 预期的上游拒绝或协议失败。
       */
      () =>
        uploads.chunk(
          instance,
          'id',
          0,
          Buffer.from('x'),
          AbortSignal.timeout(2000),
        ),
      /** 执行一个真实客户端调用以验证并发或错误行为。
       * @param 不适用。
       * @returns 上游调用的 Promise。
       * @throws OpenListError 预期的上游拒绝或协议失败。
       */
      () => uploads.complete(instance, 'id', AbortSignal.timeout(2000)),
      /** 执行一个真实客户端调用以验证并发或错误行为。
       * @param 不适用。
       * @returns 上游调用的 Promise。
       * @throws OpenListError 预期的上游拒绝或协议失败。
       */
      () => uploads.status(instance, 'id'),
      /** 执行一个真实客户端调用以验证并发或错误行为。
       * @param 不适用。
       * @returns 上游调用的 Promise。
       * @throws OpenListError 预期的上游拒绝或协议失败。
       */
      () => uploads.abort(instance, 'id'),
    ];
    for (const call of calls)
      await expect(call()).rejects.toMatchObject({ code: 'UPSTREAM_REDIRECT' });
    expect(
      fixture.server.calls.some(
        /** 筛选所需端点的实际 HTTP 请求。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 是否匹配该协议端点。
         * @throws 不适用。
         */
        (call) => call.url === '/stolen',
      ),
    ).toBe(false);
    expect(fixture.server.calls).toHaveLength(calls.length + 1);
  });

  it.each([
    { version: '4.2.4', multipart_enabled: 'true', multipart_chunk_size: '8' },
    { version: 'not-a-version', multipart_enabled: 'true' },
    { version: 'v4.2.5-rc.1', multipart_enabled: 'true' },
    // 4.2.5 之前的版本根本没有分片字段，不能被报告为协议错误。
    { version: 'v4.1.0 (Commit: old) - Frontend: v4.1.0' },
  ])(
    'connection test rejects $version without multipart init',

    /** 验证当前场景的协议输入、输出与副作用。
     * @param settings 待测上游公开设置。
     * @returns 断言完成；异步用例返回完成 Promise。
     * @throws Error 断言或测试资源操作失败。
     */
    async (settings) => {
      fixture = await componentFixture();
      fixture.server.responder =
        /** 根据请求端点返回本场景的可控上游响应。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 故障响应或 undefined 以使用默认响应。
         * @throws 不适用。
         */
        (call) =>
          call.url === '/api/public/settings' ? envelope(settings) : undefined;
      const result = await fixture.app
        .get(InstanceOperations)
        .test(fixture.id, { retryAuth: false });
      expect(result.error?.code).toBe('OPENLIST_VERSION_UNSUPPORTED');
      expect(fixture.record()).toMatchObject({
        lastErrorCode: 'OPENLIST_VERSION_UNSUPPORTED',
        openlistVersion: settings.version,
        multipartEnabled: null,
      });
      expect(
        fixture.server.calls.some(
          /** 筛选所需端点的实际 HTTP 请求。
           * @param call 捕获的真实 HTTP 请求。
           * @returns 是否匹配该协议端点。
           * @throws 不适用。
           */
          (call) => call.url.includes('/multipart/'),
        ),
      ).toBe(false);
    },
  );

  it('reports disabled multipart and accepts minimum 4.2.5 without a write probe' /** 验证当前场景的协议输入、输出与副作用。
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
        call.url === '/api/public/settings'
          ? envelope({
              version: 'v4.2.5',
              multipart_enabled: 'false',
              multipart_chunk_size: '8',
            })
          : undefined;
    const result = await fixture.app
      .get(InstanceOperations)
      .test(fixture.id, { retryAuth: false });
    expect(result).toMatchObject({
      authenticated: true,
      error: null,
      warnings: [{ code: 'MULTIPART_DISABLED' }],
    });
    expect(fixture.record().lastErrorCode).toBe('MULTIPART_DISABLED');
    expect(
      fixture.server.calls.some(
        /** 筛选所需端点的实际 HTTP 请求。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 是否匹配该协议端点。
         * @throws 不适用。
         */
        (call) => call.url.includes('/multipart/'),
      ),
    ).toBe(false);
  });
  /** 超大 Retry-After 不得溢出定时器并立即重试。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言或资源失败。
   */
  it('fails a retry that cannot fit the deadline without contacting the server again', async () => {
    fixture = await componentFixture('token');
    fixture.server.responder =
      /** 返回远超控制请求期限的限流响应。
       * @param call 上游请求。
       * @returns 响应或默认处理。
       * @throws 不适用。
       */
      (call) =>
        call.url === '/api/fs/list'
          ? { ...envelope(null, 429), headers: { 'retry-after': '9999999999' } }
          : undefined;
    await expect(
      fixture.client.list(fixture.record(), '/'),
    ).rejects.toMatchObject({ upstreamCode: 429 });
    expect(fixture.server.calls).toHaveLength(2);
  });
});

describe('M1 account capability warnings' /** 注册不依赖 F1 资源的账号能力警告用例。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */, () => {
  /** 上游 CanSeeHides 只看权限位 0，管理员缺少该位同样需要警告。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('warns about hidden entries whenever permission bit 0 is missing, including admins', () => {
    const admin = { username: 'admin', basePath: '/', role: 2 };
    expect(accountWarnings({ ...admin, permissions: 1 })).toEqual([]);
    expect(accountWarnings({ ...admin, permissions: 0 })).toMatchObject([
      { code: 'SUSPECT_VIEW' },
    ]);
    expect(
      accountWarnings({ ...admin, role: 0, permissions: 1 }),
    ).toMatchObject([{ code: 'MOUNT_BOUNDARY_UNKNOWN' }]);
  });
});

describe('OpenList version support', () => {
  it.each([
    ['v4.2.5 (Commit: cc87e88) - Frontend: v4.2.5', true],
    ['v4.2.6-rc.12 (Commit: c7c63173) - Frontend: v4.2.6 - Build at: x', true],
    ['4.3.0-beta.1', true],
    ['v5.0.0+build.7', true],
    ['v4.2.5-rc.1', false],
    ['v4.2.4', false],
    ['beta (Commit: abc) - Frontend: rolling', false],
    ['v4.2', false],
  ])(
    'compares %s by semantic version against the 4.2.5 minimum',
    /** 4.2.5 之后的预发行版本可用；4.2.5 自身的预发行与无版本号构建仍不可用。
     * @param version 上游版本字符串。
     * @param expected 是否应受支持。
     * @returns 不适用。
     * @throws Error 断言失败。
     */
    (version, expected) => {
      expect(supportedVersion(version)).toBe(expected);
    },
  );
});
