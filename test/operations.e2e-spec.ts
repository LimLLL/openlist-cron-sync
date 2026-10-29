// 通过真实HTTP验证M3路由、输入契约和 unknown 历史，不绕过Guard。
import request from 'supertest';
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { terminal, plan } from './m2-fixture.js';
import { TEST_PASSWORD, tokenOf } from './helpers.js';

/** 注册M3 API验收。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M3 operations and execution API', () => {
  let f: RelayFixture;
  let base: string;
  let token: string;
  /** 登录真实Nest应用。
   * @param 不适用。
   * @returns 已认证夹具。
   * @throws Error 登录或初始化失败。
   */
  beforeEach(async () => {
    f = await relayFixture();
    base = await f.app.getUrl();
    const response = await request(base)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: TEST_PASSWORD })
      .expect(200);
    token = tokenOf(response.body);
  });
  /** 关闭所有测试资源。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    await f.close();
  });
  /** 默认请求必须真实执行；server_copy同样被接受。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('defaults to real execution and accepts server_copy', async () => {
    const copy = f.copyJob();
    const copied = await request(base)
      .post(`/api/v1/jobs/${copy.id}/runs`)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(202);
    await terminal(f, copied.body.id as string);
    expect(f.runs().list({ page: 1, pageSize: 50 }).total).toBe(1);
    const job = f.job();
    const accepted = await request(base)
      .post(`/api/v1/jobs/${job.id}/runs`)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(202);
    expect(accepted.body.dryRun).toBe(false);
    expect((await terminal(f, accepted.body.id as string)).status).toBe(
      'succeeded',
    );
    await request(base)
      .post(`/api/v1/runs/${accepted.body.id as string}/cancel`)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(200);
  });
  /** 未知结果可按状态查询，旧管理端点和过滤参数不再存在。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('lists immutable unknown history without exposing retired administrative actions', async () => {
    f.fault =
      /** 保留init副作用但丢弃响应以创建真实 unknown 历史。
       * @param call 真实HTTP请求及其捕获头。
       * @param response 正常响应；stream回调时为测试HTTP响应。
       * @returns 本故障窗口对应的响应；其它请求保持原响应。
       * @throws 不适用。
       */
      (call, response) =>
        call.url.endsWith('/init') ? { disconnect: true } : response;
    const result = await terminal(
      f,
      f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: false }).id,
    );
    const op = plan(f, result.id)[0];
    await request(base).get(`/api/v1/operations/${op.id}`).expect(401);
    const list = await request(base)
      .get('/api/v1/operations?status=unknown')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ id: op.id, status: 'unknown' });
    for (const field of [
      'unknownUntil',
      'quarantineReleasedAt',
      'quarantineReleaseReason',
      'reobservedAt',
      'resolution',
      'causedByOperationId',
    ])
      expect(list.body.items[0]).not.toHaveProperty(field);
    for (const action of ['quarantine-release', 'resolve'])
      await request(base)
        .post(`/api/v1/operations/${op.id}/${action}`)
        .auth(token, { type: 'bearer' })
        .send({})
        .expect(404);
    await request(base)
      .get('/api/v1/operations?unresolved=true')
      .auth(token, { type: 'bearer' })
      .expect(400);
    const detail = await request(base)
      .get(`/api/v1/operations/${op.id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(detail.body).toEqual(op);
  });
  /** 一次源503后自动重试成功，两个列表均只有最终逻辑结果，详情保留失败尝试。 */
  it('lists one successful operation after a source 503 and resolves its old attempt URL', async () => {
    let rejected = false;
    f.fault = (call, response) => {
      if (call.url.startsWith('/d/') && !rejected) {
        rejected = true;
        return { status: 503, body: 'temporarily unavailable' };
      }
      return response;
    };
    const run = await terminal(
      f,
      f.runs().trigger(f.job({ retryCount: 1 }).id, {
        dryRun: false,
        confirmDeletes: false,
      }).id,
    );
    expect(run.status).toBe('succeeded');
    const operation = plan(f, run.id)[0];
    expect(operation.attemptCount).toBe(2);
    expect(operation.attempts.map((attempt) => attempt.status)).toEqual([
      'failed',
      'succeeded',
    ]);
    expect(operation.attempts[0].error?.message).toContain('503');
    for (const route of ['/operations', `/runs/${run.id}/operations`]) {
      const list = await request(base)
        .get(`/api/v1${route}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(list.body.total).toBe(1);
      expect(list.body.items[0]).toMatchObject({
        id: operation.id,
        status: 'succeeded',
        attemptCount: 2,
        error: null,
      });
      expect(list.body.items[0]).not.toHaveProperty('attempts');
      const failed = await request(base)
        .get(`/api/v1${route}?status=failed`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(failed.body.total).toBe(0);
    }
    const oldLink = await request(base)
      .get(`/api/v1/operations/${operation.attempts[1].id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(oldLink.body).toEqual(operation);
    await request(base)
      .get(`/api/v1/runs/${run.id}/operations?includeMaintenance=true`)
      .auth(token, { type: 'bearer' })
      .expect(400);
    expect(run.stats).toMatchObject({
      succeededCreates: 1,
      failedOperations: 0,
      retryAttempts: 1,
    });
  });

  /** 公共OpenAPI应反映新路由和默认真实执行。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('publishes all new routes and rejects undeclared operation queries', async () => {
    const document = await request(base)
      .get('/api/v1/openapi.json')
      .expect(200);
    for (const path of [
      '/api/v1/operations',
      '/api/v1/operations/{id}',
      '/api/v1/runs/{id}/cancel',
    ])
      expect(document.body.paths[path]).toBeDefined();
    for (const path of [
      '/api/v1/operations/{id}/quarantine-release',
      '/api/v1/operations/{id}/resolve',
    ])
      expect(document.body.paths[path]).toBeUndefined();
    expect(document.text).not.toMatch(
      /quarantineSeconds|quarantineReleasedAt|reobservedAt|resolutionKind/,
    );

    expect(
      document.body.components.schemas.TriggerRunDto.properties.dryRun.default,
    ).toBe(false);
    await request(base)
      .get('/api/v1/operations?unresolved=1')
      .auth(token, { type: 'bearer' })
      .expect(400);
    await request(base)
      .get('/api/v1/operations?unknown=true')
      .auth(token, { type: 'bearer' })
      .expect(400);
  });
});
