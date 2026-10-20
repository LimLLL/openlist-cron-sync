// 验证 Job 和 Run 路由、真实 DTO 校验、秘密投影与并发接受事务。
import request from 'supertest';
import { m2Fixture, terminal, plan } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { TEST_PASSWORD, tokenOf } from './helpers.js';
import { object, string } from '../src/openlist/errors.js';
import { latch } from './openlist-fixture.js';

/** 通过真实 HTTP 覆盖 Job 与 Run 路由的鉴权、DTO 校验、秘密投影、并发接受和 OpenAPI 形状。
 * @param 不适用。
 * @returns 不适用。
 * @throws Error 断言失败。
 */
describe('M2 Jobs and Runs API', () => {
  let f: M2Fixture;
  let token: string;
  let base: string;
  beforeEach(
    /** 启动夹具并以管理员登录取得服务 JWT。
     * @param 不适用。
     * @returns 完成 Promise。
     * @throws Error 启动或登录失败。
     */
    async () => {
      f = await m2Fixture();
      base = await f.app.getUrl();
      const login = await request(base)
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: TEST_PASSWORD })
        .expect(200);
      token = tokenOf(login.body);
    },
  );
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
  /** 所有 M2 路由在缺少服务 JWT 时返回 401。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或请求失败。
   */
  it('protects every M2 route with service JWT', async () => {
    const id = f.job().id;
    for (const [method, path] of [
      ['post', '/jobs'],
      ['get', '/jobs'],
      ['get', `/jobs/${id}`],
      ['patch', `/jobs/${id}`],
      ['delete', `/jobs/${id}`],
      ['post', `/jobs/${id}/runs`],
      ['get', '/runs'],
      ['get', `/runs/${id}`],
      ['get', `/runs/${id}/operations`],
      ['get', `/runs/${id}/issues`],
    ] as const)
      await request(base)
        [method]('/api/v1' + path)
        .send({})
        .expect(401);
  });
  /** 创建时补齐默认值且不回显秘密，按稳定目标 ID 合并补丁并清除密码；被引用的实例不可删除，删除的 Job 归档且旧目标 ID 不可复用。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或请求失败。
   */
  it('creates defaults, merges by stable target id, clears secrets and archives without reusing ids', async () => {
    const body = {
      name: 'Jobs',
      source: {
        instanceId: f.id,
        path: '//source/',
        password: 'SOURCE_PATH_SECRET',
      },
      targets: [
        { instanceId: f.id, path: '/target', password: 'TARGET_PATH_SECRET' },
      ],
    };
    const created = await request(base)
      .post('/api/v1/jobs')
      .auth(token, { type: 'bearer' })
      .send(body)
      .expect(201);
    expect(created.text).not.toMatch(
      /SOURCE_PATH_SECRET|TARGET_PATH_SECRET|_enc/,
    );
    const job = object(created.body);
    const id = string(job.id);
    expect(job).toMatchObject({
      enabled: false,
      cron: null,
      timezone: 'UTC',
      createMode: 'relay',
      source: { path: '/source', hasPassword: true, refresh: false },
      notificationChannelIds: [],
    });
    const target = f.jobs().get(id).targets[0];
    await request(base)
      .patch(`/api/v1/jobs/${id}`)
      .auth(token, { type: 'bearer' })
      .send({
        source: { password: null },
        targets: [
          { id: target.id, mode: 'mirror', deleteLimits: { maxCount: 0 } },
        ],
      })
      .expect(200);
    expect(f.jobs().get(id)).toMatchObject({
      source: { hasPassword: false },
      targets: [
        {
          id: target.id,
          hasPassword: true,
          mode: 'mirror',
          deleteLimits: { enabled: true, maxCount: 0, maxPercent: 50 },
        },
      ],
    });
    await request(base)
      .patch(`/api/v1/jobs/${id}`)
      .auth(token, { type: 'bearer' })
      .send({ targets: [{ instanceId: f.id, path: '/new-target' }] })
      .expect(200);
    await request(base)
      .patch(`/api/v1/jobs/${id}`)
      .auth(token, { type: 'bearer' })
      .send({ targets: [{ id: target.id }] })
      .expect(400);
    await request(base)
      .delete(`/api/v1/instances/${f.id}`)
      .auth(token, { type: 'bearer' })
      .expect(409);
    await request(base)
      .delete(`/api/v1/jobs/${id}`)
      .auth(token, { type: 'bearer' })
      .expect(204);
    await request(base)
      .get(`/api/v1/jobs/${id}`)
      .auth(token, { type: 'bearer' })
      .expect(404);
    const list = await request(base)
      .get('/api/v1/jobs?includeArchived=true&pageSize=1')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(object(list.body).total).toBe(1);
  });
  it.each([
    {},
    { timezone: 'system' },
    { timezone: 'UTC+8' },
    { timezone: 'No/Such_Zone' },
    { timeoutSeconds: 0 },
    { notificationChannelIds: ['249decb2-3d69-4dab-ac30-c033f8ce672e'] },
    { filters: { include: ['!x'] } },
    { filters: { minSizeBytes: 2, maxSizeBytes: 1 } },
    { source: { extra: true } },
    { source: { password: '' } },
    { targets: [] },
  ])(
    'rejects invalid merged Job patch %j',
    /** 合并后不合法的 Job 补丁返回 400。
     * @param patch 非法补丁：空补丁、非法时区、超时、通知渠道、过滤器、源或目标字段。
     * @returns 完成 Promise。
     * @throws Error 断言或请求失败。
     */
    async (patch) => {
      const id = f.job().id;
      await request(base)
        .patch(`/api/v1/jobs/${id}`)
        .auth(token, { type: 'bearer' })
        .send(patch)
        .expect(400);
    },
  );
  /** 目标空密码在创建和稳定 ID 补丁中均被拒绝，拒绝后保留旧密码，只有 null 清除。
   * @param 不适用。
   * @returns HTTP 校验及密码标志断言完成。
   * @throws Error 夹具、请求或断言失败。
   */
  it('rejects empty Target passwords without clearing a saved password', async () => {
    const body = {
      name: 'Password validation',
      source: { instanceId: f.id, path: '/source' },
      targets: [{ instanceId: f.id, path: '/target', password: '' }],
    };
    await request(base)
      .post('/api/v1/jobs')
      .auth(token, { type: 'bearer' })
      .send(body)
      .expect(400);
    expect(f.jobs().list(1, 50, false).total).toBe(0);
    const job = f.job({
      targets: [{ instanceId: f.id, path: '/target', password: 'path-secret' }],
    });
    const targetId = job.targets[0].id;
    await request(base)
      .patch(`/api/v1/jobs/${job.id}`)
      .auth(token, { type: 'bearer' })
      .send({ targets: [{ id: targetId, password: '' }] })
      .expect(400);
    expect(f.jobs().get(job.id).targets[0].hasPassword).toBe(true);
    const cleared = await request(base)
      .patch(`/api/v1/jobs/${job.id}`)
      .auth(token, { type: 'bearer' })
      .send({ targets: [{ id: targetId, password: null }] })
      .expect(200);
    expect(f.jobs().get(job.id).targets[0].hasPassword).toBe(false);
    expect(cleared.text).not.toContain('path-secret');
  });
  /** 拒绝六字段、别名和越界的 cron 表达式，错误码为 INVALID_CRON。
   * @param cron 不支持的 cron 表达式。
   * @returns 完成 Promise。
   * @throws Error 断言或请求失败。
   */
  it.each(['* * * * * *', '@daily', '@reboot', '61 * * * *'])(
    'rejects unsupported cron %s',
    async (cron) => {
      const id = f.job().id;
      const result = await request(base)
        .patch(`/api/v1/jobs/${id}`)
        .auth(token, { type: 'bearer' })
        .send({ cron })
        .expect(400);
      expect(object(object(result.body).error).code).toBe('INVALID_CRON');
    },
  );
  /** 接受并保存五字段 cron 与合法时区，但不产生调度 Run，也不提供下次触发时间端点。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或请求失败。
   */
  it('accepts stored five-field cron without scheduling and validates timezone for manual jobs', async () => {
    const id = f.job().id;
    await request(base)
      .patch(`/api/v1/jobs/${id}`)
      .auth(token, { type: 'bearer' })
      .send({ cron: '0 2 * * *', timezone: 'Europe/Berlin', enabled: true })
      .expect(200);
    expect(f.runs().list({ page: 1, pageSize: 50 }).total).toBe(0);
    await request(base)
      .get(`/api/v1/jobs/${id}/next-fire-times`)
      .auth(token, { type: 'bearer' })
      .expect(404);
  });
  /** 缺失、为 false 或非法的 dryRun 被拒绝且不创建 Run；未启用的 Job 仍可手动预览，Run 查询端点可分页并校验查询参数。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或请求失败。
   */
  it('rejects false or missing dryRun without creating a Run, accepts disabled manual preview and pages its plan', async () => {
    const job = f.job();
    for (const body of [
      {},
      { dryRun: false },
      { dryRun: 'true' },
      { dryRun: true, unknown: true },
    ])
      await request(base)
        .post(`/api/v1/jobs/${job.id}/runs`)
        .auth(token, { type: 'bearer' })
        .send(body)
        .expect(400);
    expect(f.runs().list({ page: 1, pageSize: 50 }).total).toBe(0);
    const accepted = await request(base)
      .post(`/api/v1/jobs/${job.id}/runs`)
      .auth(token, { type: 'bearer' })
      .send({ dryRun: true })
      .expect(202);
    const id = string(object(accepted.body).id);
    expect(accepted.headers.location).toBe(`/api/v1/runs/${id}`);
    await terminal(f, id);
    for (const path of [
      `/runs?jobId=${job.id}&dryRun=true`,
      `/runs/${id}`,
      `/runs/${id}/operations?pageSize=1`,
      `/runs/${id}/issues`,
    ])
      await request(base)
        .get('/api/v1' + path)
        .auth(token, { type: 'bearer' })
        .expect(200);
    expect(plan(f, id)[0].seq).toBe(1);
    for (const path of [
      `/runs/${id}/operations?extra=x`,
      '/runs?dryRun=1',
      '/runs?page=1.5',
    ])
      await request(base)
        .get('/api/v1' + path)
        .auth(token, { type: 'bearer' })
        .expect(400);
  });
  /** 两个并发触发只接受一个，Job 存在活动 Run 时拒绝编辑和删除。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或请求失败。
   */
  it('accepts only one of two concurrent triggers and refuses editing an active Job', async () => {
    const gate = latch();
    const responder = f.server.responder;
    f.server.responder =
      /** 列表请求挂起到门闩释放，使首个 Run 保持活动；其余请求交给原 responder。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 原 responder 的结果。
       * @throws 不适用。
       */
      async (call) => {
        if (call.url === '/api/fs/list') await gate.promise;
        return responder?.(call);
      };
    const job = f.job();
    const results = await Promise.all(
      [1, 2].map(
        /** 对同一 Job 发起一次 dry-run 触发请求。
         * @param 不适用。
         * @returns 可 await 的 supertest 请求。
         * @throws 不适用。
         */
        () =>
          request(base)
            .post(`/api/v1/jobs/${job.id}/runs`)
            .auth(token, { type: 'bearer' })
            .send({ dryRun: true }),
      ),
    );
    expect(
      results
        .map(
          /** 提取响应状态码。
           * @param r HTTP 响应。
           * @returns 状态码。
           * @throws 不适用。
           */
          (r) => r.status,
        )
        .sort(),
    ).toEqual([202, 409]);
    await request(base)
      .patch(`/api/v1/jobs/${job.id}`)
      .auth(token, { type: 'bearer' })
      .send({ name: 'busy' })
      .expect(409);
    await request(base)
      .delete(`/api/v1/jobs/${job.id}`)
      .auth(token, { type: 'bearer' })
      .expect(409);
    gate.release();
    const accepted = results.find(
      /** 定位被接受的触发响应。
       * @param r HTTP 响应。
       * @returns 是否为 202。
       * @throws 不适用。
       */
      (r) => r.status === 202,
    );
    if (!accepted) throw new Error('No accepted Run');
    await terminal(f, string(object(accepted.body).id));
  });
  /** OpenAPI 公布完整的预览 DTO 形状与错误码，且不暴露秘密存储字段。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或请求失败。
   */
  it('publishes complete preview shapes and no secret storage fields in OpenAPI', async () => {
    const response = await request(base)
      .get('/api/v1/openapi.json')
      .expect(200);
    expect(response.body).toMatchObject({
      paths: {
        '/api/v1/jobs': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { required: ['name', 'source', 'targets'] },
                },
              },
            },
          },
        },
      },
    });
    expect(response.text).toContain('DELETE_BLOCKED');
    expect(response.text).toContain('snapshotVersion');
    expect(response.text).toContain('quarantineSeconds');
    expect(response.text).toContain('/api/v1/runs/{id}/operations');
    expect(response.text).not.toMatch(
      /secret_snapshot_enc|source_password_enc|password_enc/,
    );
  });
});
