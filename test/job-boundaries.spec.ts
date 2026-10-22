// 验证配置与运行能力边界，以及同地址不同账号的路径比较。
import { m2Fixture, listing, preview } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { envelope, file } from './openlist-fixture.js';
import { InstancesService } from '../src/instances/instances.service.js';
import { InstanceOperations } from '../src/instances/instance-operations.service.js';
import { object } from '../src/openlist/errors.js';

/** 覆盖 Job 的配置与运行能力边界、端点路径重叠，以及同地址不同账号的路径比较。
 * @param 不适用。
 * @returns 不适用。
 * @throws Error 断言失败。
 */
describe('M2 job boundaries', () => {
  let f: M2Fixture;
  afterEach(
    /** 关闭本用例创建的夹具。
     * @param 不适用。
     * @returns 完成 Promise。
     * @throws Error 清理失败。
     */
    async () => {
      if (f) await f.close();
    },
  );
  /** 引用未测试实例的 Job 可保存为禁用配置，但拒绝启用和手动预览，并拒绝无效的 server_copy 配置。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('allows disabled untested configuration but refuses enable and manual preview', async () => {
    f = await m2Fixture();
    const untested = f.app.get(InstancesService).create({
      name: 'Untested',
      baseUrl: f.server.baseUrl + '/other',
      auth: { mode: 'token', secret: 'untested' },
    });
    const job = f.job({ targets: [{ instanceId: untested.id, path: '/' }] });
    expect(
      /** 启用引用未测试端点的 Job。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期的 Endpoint must be tested。
       */
      () => f.jobs().patch(job.id, { enabled: true }),
    ).toThrow('Endpoint must be tested');
    expect(
      /** 对引用未测试端点的 Job 触发 dry-run。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期的 Endpoint must be tested。
       */
      () => f.runs().trigger(job.id, { dryRun: true, confirmDeletes: false }),
    ).toThrow('Endpoint must be tested');
    expect(
      /** 把目标改为 server_copy 创建方式。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期的 Invalid job configuration。
       */
      () =>
        f.jobs().patch(job.id, {
          targets: [{ id: job.targets[0].id, createMode: 'server_copy' }],
        }),
    ).toThrow('Invalid job configuration');
  });
  /** 实例版本过低或未开启 multipart 时拒绝启用 relay Job 和 dry-run；仅缺 multipart 时 server_copy 仍可预览。
   * @param kind 缺失的能力：version 或 multipart。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it.each(['version', 'multipart'])(
    'enforces %s capability for enabled Job and dry-run',
    async (kind) => {
      f = await m2Fixture();
      const original = f.server.responder;
      f.server.responder =
        /** 公共设置请求按场景返回低版本或关闭 multipart 的设置，其余请求交给原 responder。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 设置响应或原 responder 的结果。
         * @throws 不适用。
         */
        (call) =>
          call.url === '/api/public/settings'
            ? envelope({
                version: kind === 'version' ? 'v4.2.4' : 'v4.2.7',
                multipart_enabled: 'false',
                multipart_chunk_size: '8',
              })
            : original?.(call);
      await f.app.get(InstanceOperations).test(f.id, { retryAuth: false });
      const job = f.job();
      expect(
        /** 启用能力不足实例上的 Job。
         * @param 不适用。
         * @returns 不适用。
         * @throws Error 预期的能力校验错误。
         */
        () => f.jobs().patch(job.id, { enabled: true }),
      ).toThrow();
      expect(
        /** 对能力不足实例上的 Job 触发 dry-run。
         * @param 不适用。
         * @returns 不适用。
         * @throws Error 预期的能力校验错误。
         */
        () => f.runs().trigger(job.id, { dryRun: true, confirmDeletes: false }),
      ).toThrow();
      if (kind === 'multipart') {
        const copy = f.jobs().patch(job.id, {
          targets: [{ id: job.targets[0].id, createMode: 'server_copy' }],
          enabled: true,
        });
        expect((await preview(f, copy)).status).toBe('succeeded');
      }
    },
  );
  /** 按路径段判断源与目标重叠并拒绝分享根等非法路径，同前缀的兄弟路径允许。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('rejects segment overlap and share roots but permits sibling prefixes', async () => {
    f = await m2Fixture();
    for (const path of ['/source', '/source/a', '/'])
      expect(
        /** 以与源重叠的路径创建目标。
         * @param 不适用。
         * @returns 不适用。
         * @throws Error 预期的 Job endpoints overlap。
         */
        () => f.job({ targets: [{ instanceId: f.id, path }] }),
      ).toThrow('Job endpoints overlap');
    for (const path of ['/@s', '/@sync', '/a/../b', '/a\\b'])
      expect(
        /** 以分享根或非规范路径创建源。
         * @param 不适用。
         * @returns 不适用。
         * @throws Error 预期的路径校验错误。
         */
        () => f.job({ source: { instanceId: f.id, path } }),
      ).toThrow();
    expect(
      f.job({ targets: [{ instanceId: f.id, path: '/source-other' }] })
        .targets[0].path,
    ).toBe('/source-other');
  });
  /** 同一 baseUrl 的不同账号按各自 accountBasePath 换算后比较重叠，且不探测账号根之上的目录。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('compares same-baseUrl aliases after accountBasePath and never probes above an account root', async () => {
    f = await m2Fixture();
    const original = f.server.responder;
    f.server.responder =
      /** other-token 的 /api/me 返回 base_path 为 /source 的账号，其余请求交给原 responder。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 账号响应或原 responder 的结果。
       * @throws 不适用。
       */
      (call) =>
        call.url === '/api/me' && call.headers.authorization === 'other-token'
          ? envelope({
              username: 'other',
              base_path: '/source',
              role: 2,
              permission: 255,
            })
          : original?.(call);
    const other = f.app.get(InstancesService).create({
      name: 'Other',
      baseUrl: f.server.baseUrl + '/',
      auth: { mode: 'token', secret: 'other-token' },
    });
    await f.app.get(InstanceOperations).test(other.id, { retryAuth: false });
    expect(
      /** 以换算后与源重叠的别名路径创建目标。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期的 Job endpoints overlap。
       */
      () => f.job({ targets: [{ instanceId: other.id, path: '/nested' }] }),
    ).toThrow('Job endpoints overlap');
    const job = f.job({
      source: { instanceId: f.id, path: '/outside' },
      targets: [{ instanceId: other.id, path: '/' }],
    });
    f.tree.set('/outside', listing(file()));
    const before = f.server.calls.length;
    const run = await preview(f, job);
    expect(run.targets[0].blockReasons).toContain('TARGET_ROOT_UNAVAILABLE');
    expect(
      f.server.calls
        .slice(before)
        .filter(
          /** 筛选以 other 账号发出的列表请求。
           * @param call 捕获的真实 HTTP 请求。
           * @returns 是否为 other-token 的列表请求。
           * @throws 不适用。
           */
          (call) =>
            call.url === '/api/fs/list' &&
            call.headers.authorization === 'other-token',
        )
        .map(
          /** 提取列表请求的路径。
           * @param call 捕获的列表请求。
           * @returns 请求体中的 path。
           * @throws OpenListError 请求体不是对象。
           */
          (call) => object(call.json).path,
        ),
    ).toEqual(['/']);
  });
  /** 账号根下的分享保留名作为固定保护跳过，不被列出，也不降级为 INVALID_NAME 问题。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('treats root share exclusions as fixed protection without INVALID_NAME degradation', async () => {
    f = await m2Fixture();
    const original = f.server.responder;
    f.server.responder =
      /** source-root-token 的 /api/me 返回 base_path 为 /root-source 的账号，其余请求交给原 responder。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 账号响应或原 responder 的结果。
       * @throws 不适用。
       */
      (call) =>
        call.url === '/api/me' &&
        call.headers.authorization === 'source-root-token'
          ? envelope({
              username: 'root-source',
              base_path: '/root-source',
              role: 2,
              permission: 255,
            })
          : original?.(call);
    const source = f.app.get(InstancesService).create({
      name: 'Root source',
      baseUrl: f.server.baseUrl,
      auth: { mode: 'token', secret: 'source-root-token' },
    });
    await f.app.get(InstanceOperations).test(source.id, { retryAuth: false });
    f.tree.set('/', listing(file('@sync'), file('normal')));
    const job = f.job({ source: { instanceId: source.id, path: '/' } });
    const run = await preview(f, job);
    expect(run.status).toBe('succeeded');
    expect(run.issueCount).toBe(0);
    expect(
      f.server.calls.some(
        /** 检查是否列出了分享保留名 /@sync。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 是否为 /@sync 的列表请求。
         * @throws OpenListError 请求体不是对象。
         */
        (call) =>
          call.url === '/api/fs/list' && object(call.json).path === '/@sync',
      ),
    ).toBe(false);
  });
});
