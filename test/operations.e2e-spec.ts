// 通过真实HTTP验证M3路由、输入契约和unknown管理，不绕过Guard。
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
  /** 管理动作必须独立记录、幂等且保持unknown历史。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('lists, releases and abandons unknown without rewriting its outcome', async () => {
    f.fault =
      /** 保留init副作用但丢弃响应以创建真实unknown责任。
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
      .get('/api/v1/operations?status=unknown&unresolved=true')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(list.body.total).toBe(1);
    for (const reason of ['', '   ', null])
      await request(base)
        .post(`/api/v1/operations/${op.id}/quarantine-release`)
        .auth(token, { type: 'bearer' })
        .send({ reason })
        .expect(400);
    const release = await request(base)
      .post(`/api/v1/operations/${op.id}/quarantine-release`)
      .auth(token, { type: 'bearer' })
      .send({ reason: 'Reviewed' })
      .expect(200);
    const repeat = await request(base)
      .post(`/api/v1/operations/${op.id}/quarantine-release`)
      .auth(token, { type: 'bearer' })
      .send({ reason: 'Different' })
      .expect(200);
    expect(repeat.body.quarantineReleasedAt).toBe(
      release.body.quarantineReleasedAt,
    );
    const resolved = await request(base)
      .post(`/api/v1/operations/${op.id}/resolve`)
      .auth(token, { type: 'bearer' })
      .send({ kind: 'abandoned', reason: 'Done' })
      .expect(200);
    expect(resolved.body.status).toBe('unknown');
    expect(resolved.body.resolution.note).toBe('Done');
    const again = await request(base)
      .post(`/api/v1/operations/${op.id}/resolve`)
      .auth(token, { type: 'bearer' })
      .send({ kind: 'abandoned', reason: 'Changed' })
      .expect(200);
    expect(again.body.resolution.note).toBe('Done');
    const remaining = await request(base)
      .get('/api/v1/operations?unresolved=true')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(remaining.body.total).toBe(0);
    const settled = await request(base)
      .get('/api/v1/operations?status=unknown&unresolved=false')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(settled.body.total).toBe(1);
    expect(settled.body.items[0].id).toBe(op.id);
    await request(base)
      .post(`/api/v1/operations/${op.id}/quarantine-release`)
      .auth(token, { type: 'bearer' })
      .send({ reason: 'Too late' })
      .expect(409);
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
      '/api/v1/operations/{id}/quarantine-release',
      '/api/v1/operations/{id}/resolve',
      '/api/v1/runs/{id}/cancel',
    ])
      expect(document.body.paths[path]).toBeDefined();
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
