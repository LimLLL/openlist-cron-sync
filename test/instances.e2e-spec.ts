// 通过真实 Guard、ValidationPipe、OpenAPI 和 SQLite 验证实例管理端点。
import request from 'supertest';
import { TEST_PASSWORD, tokenOf } from './helpers.js';
import { componentFixture, envelope, file } from './openlist-fixture.js';
import type { ComponentFixture } from './openlist-fixture.js';
import { object, string } from '../src/openlist/errors.js';

describe('M1 instances API' /** 注册本组 M1 行为验收用例。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */, () => {
  let fixture: ComponentFixture;
  let base: string;
  let token: string;
  beforeEach(
    /** 创建隔离应用并准备本组测试身份。
     * @param 不适用。
     * @returns 初始化完成的 Promise。
     * @throws Error 测试初始化失败。
     */
    async () => {
      fixture = await componentFixture('token');
      base = await fixture.app.getUrl();
      const result = await request(base)
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: TEST_PASSWORD })
        .expect(200);
      token = tokenOf(result.body);
    },
  );
  afterEach(
    /** 恢复测试状态并释放本用例拥有的资源。
     * @param 不适用。
     * @returns 清理完成；异步资源返回 Promise。
     * @throws Error 资源清理失败。
     */
    async () => {
      if (fixture) await fixture.close();
    },
  );

  it('requires service authentication for every M1 route' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    for (const [method, path] of [
      ['get', ''],
      ['post', ''],
      ['get', `/${fixture.id}`],
      ['patch', `/${fixture.id}`],
      ['delete', `/${fixture.id}`],
      ['post', `/${fixture.id}/test`],
      ['post', `/${fixture.id}/browse`],
    ] as const) {
      await request(base)
        [method]('/api/v1/instances' + path)
        .send({})
        .expect(401);
    }
  });
  it('creates, merges limits, reads pages and archives with the exact public shape' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    const created = await request(base)
      .post('/api/v1/instances')
      .auth(token, { type: 'bearer' })
      .send({
        name: 'New',
        baseUrl: fixture.server.baseUrl + '///',
        auth: {
          mode: 'password',
          username: 'admin',
          secret: 'SECRET-NEVER-RETURNED',
        },
        limits: { maxApiConcurrency: 3 },
      })
      .expect(201);
    const data = object(created.body);
    const id = string(data.id);
    expect(data).toMatchObject({
      name: 'New',
      baseUrl: fixture.server.baseUrl,
      auth: { mode: 'password', username: 'admin', hasSecret: true },
      limits: {
        maxApiConcurrency: 3,
        apiRequestsPerSecond: 5,
        maxChunkConcurrency: 4,
      },
      authState: 'untested',
      accountUsername: null,
      lastError: null,
      archivedAt: null,
    });
    expect(JSON.stringify(data)).not.toMatch(
      /SECRET-NEVER-RETURNED|secretEnc|secret_enc|nonce|ciphertext/,
    );
    const updated = await request(base)
      .patch('/api/v1/instances/' + id)
      .auth(token, { type: 'bearer' })
      .send({ limits: { maxChunkConcurrency: 2 }, name: 'Renamed' })
      .expect(200);
    expect(updated.body).toMatchObject({
      name: 'Renamed',
      limits: { maxApiConcurrency: 3, maxChunkConcurrency: 2 },
    });
    expect(fixture.server.calls).toHaveLength(0);
    const page = await request(base)
      .get('/api/v1/instances?page=1&pageSize=1')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(page.body).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      items: [{ id }],
    });
    await request(base)
      .get('/api/v1/instances/' + id)
      .auth(token, { type: 'bearer' })
      .expect(200);
    await request(base)
      .delete('/api/v1/instances/' + id)
      .auth(token, { type: 'bearer' })
      .expect(204)
      .expect('');
    await request(base)
      .get('/api/v1/instances/' + id)
      .auth(token, { type: 'bearer' })
      .expect(404);
    const archived = await request(base)
      .get('/api/v1/instances?includeArchived=true')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(archived.body).toMatchObject({
      total: 2,
      items: [{ id, auth: { hasSecret: false } }, { id: fixture.id }],
    });
  });
  it('accepts zero and the safe-integer ceiling for every instance quota' /** 0 表示不限，正数没有产品上限，只受安全整数约束。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    const limits = {
      maxApiConcurrency: 0,
      apiRequestsPerSecond: 0,
      maxOutstandingTasks: 0,
      maxDownloadConnections: 0,
      maxUploadSessions: 0,
      maxChunkConcurrency: 0,
    };
    const zero = await request(base)
      .patch('/api/v1/instances/' + fixture.id)
      .auth(token, { type: 'bearer' })
      .send({ limits })
      .expect(200);
    expect(zero.body.limits).toEqual(limits);
    const ceiling = Object.fromEntries(
      Object.keys(limits).map((key) => [key, Number.MAX_SAFE_INTEGER]),
    );
    const max = await request(base)
      .patch('/api/v1/instances/' + fixture.id)
      .auth(token, { type: 'bearer' })
      .send({ limits: ceiling })
      .expect(200);
    expect(max.body.limits).toEqual(ceiling);
  });
  it('rejects invalid, unknown, null and discriminator inputs without contacting OpenList' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    const invalid = [
      {},
      { name: null },
      { extra: true },
      { auth: null },
      { auth: { mode: 'token', secret: 'value', username: 'forbidden' } },
      { auth: { mode: 'password', secret: 'value' } },
      { auth: { mode: 'token', secret: null } },
      { auth: { mode: 'token', secret: '***' } },
      { auth: { mode: 'token', secret: 'x\r\ny' } },
      { limits: null },
      { limits: { maxApiConcurrency: -1 } },
      { limits: { maxApiConcurrency: 1.5 } },
      { limits: { apiRequestsPerSecond: '5' } },
      { limits: { unknown: 1 } },
      { downloadMode: null },
      { baseUrl: 'ftp://host' },
      { baseUrl: 'https://user:password@host' },
      { baseUrl: 'https://host/path?secret=1' },
      { baseUrl: 'https://host/#fragment' },
    ];
    for (const body of invalid)
      await request(base)
        .patch('/api/v1/instances/' + fixture.id)
        .auth(token, { type: 'bearer' })
        .send(body)
        .expect(400);
    for (const query of [
      '?page=0',
      '?page=1e2',
      '?pageSize=201',
      '?includeArchived=yes',
      '?unknown=1',
    ])
      await request(base)
        .get('/api/v1/instances' + query)
        .auth(token, { type: 'bearer' })
        .expect(400);
    await request(base)
      .get('/api/v1/instances/' + fixture.id + '?unknown=1')
      .auth(token, { type: 'bearer' })
      .expect(400);
    expect(fixture.server.calls).toHaveLength(0);
  });
  it('returns a completed failed TestResult as 200 and a manual cooldown as 409' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) => (call.url === '/api/me' ? envelope(null, 401) : undefined);
    const failed = await request(base)
      .post(`/api/v1/instances/${fixture.id}/test`)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(200);
    expect(failed.body).toMatchObject({
      authenticated: false,
      account: null,
      error: { code: 'AUTH_BLOCKED' },
    });
    await request(base)
      .patch(`/api/v1/instances/${fixture.id}`)
      .auth(token, { type: 'bearer' })
      .send({
        auth: { mode: 'password', username: 'admin', secret: 'wrong-password' },
      })
      .expect(200);
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) =>
        call.url === '/api/auth/login/hash' ? envelope(null, 429) : undefined;
    await request(base)
      .post(`/api/v1/instances/${fixture.id}/test`)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(200);
    const cooldown = await request(base)
      .post(`/api/v1/instances/${fixture.id}/test`)
      .auth(token, { type: 'bearer' })
      .send({ retryAuth: true })
      .expect(409);
    expect(cooldown.body).toMatchObject({ error: { code: 'AUTH_COOLDOWN' } });
  });
  it('browses safe items with warnings and maps upstream errors to 502' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    const path = `/api/v1/instances/${fixture.id}/browse`;
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) =>
        call.url === '/api/fs/list'
          ? envelope({
              content: [
                file('a\\b'),
                file('ok'),
                { ...file('unknown'), size: -1 },
              ],
              total: 3,
              write: true,
            })
          : undefined;
    const result = await request(base)
      .post(path)
      .auth(token, { type: 'bearer' })
      .send({
        path: '//folder//',
        password: 'path-secret',
        page: 1,
        pageSize: 1,
      })
      .expect(200);
    expect(result.body).toMatchObject({
      path: '/folder',
      items: [{ name: 'ok', size: 12, isDir: false }],
      total: 2,
      page: 1,
      pageSize: 1,
      warnings: [{ code: 'INVALID_NAME' }],
    });
    expect(JSON.stringify(result.body)).not.toMatch(
      /sign|raw_url|path-secret|private-sign/,
    );
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) => (call.url === '/api/fs/list' ? envelope(null, 500) : undefined);
    expect(
      (
        await request(base)
          .post(path)
          .auth(token, { type: 'bearer' })
          .send({ path: '/' })
          .expect(502)
      ).body,
    ).toMatchObject({ error: { code: 'OPENLIST_ERROR' } });
    fixture.server.responder =
      /** 筛选所需端点的实际 HTTP 请求。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 是否匹配该协议端点。
       * @throws 不适用。
       */
      (call) => (call.url === '/api/fs/list' ? { body: '<bad>' } : undefined);
    expect(
      (
        await request(base)
          .post(path)
          .auth(token, { type: 'bearer' })
          .send({ path: '/' })
          .expect(502)
      ).body,
    ).toMatchObject({ error: { code: 'UPSTREAM_PROTOCOL_ERROR' } });
  });
  it.each([
    '/@s',
    '/@sync',
    '// @s/../x',
    '/a/../x',
    '/a/./b',
    '/a\\b',
    '/\u0000',
    'relative',
  ])(
    'rejects browse path %s with INVALID_PATH',

    /** 验证当前场景的协议输入、输出与副作用。
     * @param path 待测账号路径。
     * @returns 断言完成；异步用例返回完成 Promise。
     * @throws Error 断言或测试资源操作失败。
     */
    async (path) => {
      const result = await request(base)
        .post(`/api/v1/instances/${fixture.id}/browse`)
        .auth(token, { type: 'bearer' })
        .send({ path })
        .expect(400);
      expect(result.body).toMatchObject({ error: { code: 'INVALID_PATH' } });
      expect(fixture.server.calls).toHaveLength(0);
    },
  );
  it('publishes accurate route statuses and response schemas without storage secrets' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    const response = await request(base)
      .get('/api/v1/openapi.json')
      .expect(200);
    const doc = object(response.body);
    const paths = object(doc.paths);
    expect(
      object(object(paths['/api/v1/instances']).post).responses,
    ).toHaveProperty('201');
    expect(
      object(object(paths['/api/v1/instances/{id}/test']).post).responses,
    ).toHaveProperty('409');
    expect(
      object(object(paths['/api/v1/instances/{id}/browse']).post).responses,
    ).toHaveProperty('502');
    const schemas = object(object(doc.components).schemas);
    const properties = object(object(schemas.InstanceView).properties);
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining([
        'authState',
        'lastError',
        'multipartEnabled',
        'archivedAt',
      ]),
    );
    expect(JSON.stringify(schemas)).not.toMatch(
      /"(?:secret_enc|secretEnc|raw_url|addition)":/,
    );
    expect(
      object(object(schemas.TestRequestDto).properties).retryAuth,
    ).toMatchObject({ type: 'boolean', default: false });
    expect(
      object(object(schemas.BrowseRequestDto).properties).refresh,
    ).toMatchObject({ type: 'boolean', default: false });
    expect(
      object(object(object(schemas.InstanceCreateDto).properties).auth).oneOf,
    ).toHaveLength(2);
    expect(object(object(schemas.InstanceView).properties).auth).toEqual({
      $ref: '#/components/schemas/AuthView',
    });
  });
});
