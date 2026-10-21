// 经真实 HTTP 验证每目标创建方式的输入、合并、能力边界和公开契约。
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { m2Fixture, listing, preview, plan } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { TEST_PASSWORD, tokenOf } from './helpers.js';
import { InstancesService } from '../src/instances/instances.service.js';
import { InstanceOperations } from '../src/instances/instance-operations.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { instances } from '../src/database/schema.js';
import {
  jobCreateSchema,
  jobPatchSchema,
  jobViewSchema,
} from '../src/jobs/api-schemas.js';
import { runDetailSchema } from '../src/runs/api-schemas.js';

/** 注册每目标 API 验收。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('per-Target create mode API', () => {
  let f: M2Fixture;
  let base: string;
  let token: string;
  let other: string;
  /** 建立同 URL 不同 ID 的实例，以验证身份而非地址比较。
   * @param 不适用。
   * @returns 已认证夹具。
   * @throws Error 初始化或连接测试失败。
   */
  beforeEach(async () => {
    f = await m2Fixture();
    base = await f.app.getUrl();
    token = tokenOf(
      (
        await request(base)
          .post('/api/v1/auth/login')
          .send({ username: 'admin', password: TEST_PASSWORD })
          .expect(200)
      ).body,
    );
    other = f.app.get(InstancesService).create({
      name: 'Other Instance',
      baseUrl: f.server.baseUrl,
      auth: { mode: 'token', secret: 'other-fixture-token' },
    }).id;
    await f.app.get(InstanceOperations).test(other, { retryAuth: false });
    f.tree.set('/copy', listing());
    f.tree.set('/relay', listing());
  });
  /** 关闭本例的独立数据库和 HTTP 夹具。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 资源释放失败。
   */
  afterEach(async () => {
    await f.close();
  });

  /** 混合配置计划正确，后续编辑不改写已有 Run 的任一快照副本。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('accepts mixed Targets, plans per snapshot and preserves history after editing', async () => {
    const created = await request(base)
      .post('/api/v1/jobs')
      .auth(token, { type: 'bearer' })
      .send({
        name: 'Mixed',
        source: { instanceId: f.id, path: '/source' },
        targets: [
          { instanceId: f.id, path: '/copy', createMode: 'server_copy' },
          { instanceId: other, path: '/relay' },
        ],
      })
      .expect(201);
    expect(created.body).not.toHaveProperty('createMode');
    const job = f.jobs().get(created.body.id as string);
    const result = await preview(f, job);
    expect(plan(f, result.id).map((op) => op.method)).toEqual([
      'server_copy',
      'relay',
    ]);
    expect(
      result.targets.map((target) => target.config.target.createMode),
    ).toEqual(['server_copy', 'relay']);
    const edited = f.jobs().patch(job.id, {
      targets: [
        { id: job.targets[0].id, createMode: 'relay' },
        { id: job.targets[1].id },
      ],
    });
    expect(edited.targets[0].createMode).toBe('relay');
    expect(f.runs().get(result.id).config).toEqual(result.config);
    expect(f.runs().get(result.id).targets).toEqual(result.targets);
  });
  /** 现有目标按 ID 保留配置，新增默认 relay，移除目标不能重新使用 ID。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('merges by stable Target ID across reorder, omission, addition and removal', async () => {
    const job = f.job({
      targets: [
        { instanceId: f.id, path: '/copy', createMode: 'server_copy' },
        { instanceId: other, path: '/relay' },
      ],
    });
    expect(f.jobs().patch(job.id, { name: 'Renamed' }).targets).toEqual(
      job.targets,
    );
    const changed = await request(base)
      .patch(`/api/v1/jobs/${job.id}`)
      .auth(token, { type: 'bearer' })
      .send({
        targets: [
          { id: job.targets[1].id },
          { id: job.targets[0].id },
          { instanceId: f.id, path: '/new' },
        ],
      })
      .expect(200);
    expect(changed.body.targets).toMatchObject([
      { id: job.targets[1].id, createMode: 'relay', position: 0 },
      { id: job.targets[0].id, createMode: 'server_copy', position: 1 },
      { createMode: 'relay', position: 2 },
    ]);
    f.jobs().patch(job.id, { targets: [{ id: job.targets[1].id }] });
    expect(() =>
      f.jobs().patch(job.id, { targets: [{ id: job.targets[0].id }] }),
    ).toThrow();
  });
  /** 旧顶层字段在创建和更新入口均作为未知字段拒绝。
   * @param method 请求入口。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it.each(['post', 'patch'] as const)(
    'rejects top-level createMode on %s',
    async (method) => {
      const job = f.job();
      await request(base)
        [method](method === 'post' ? '/api/v1/jobs' : `/api/v1/jobs/${job.id}`)
        .auth(token, { type: 'bearer' })
        .send({
          name: 'Invalid',
          source: { instanceId: f.id, path: '/source' },
          targets: [{ instanceId: f.id, path: '/target' }],
          createMode: 'relay',
        })
        .expect(400);
    },
  );
  /** 缺省值与显式非法值必须区分，拒绝时指明目标序号。
   * @param value 非法创建方式。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it.each([null, '', 'auto', 0])(
    'rejects invalid Target mode %s',
    async (value) => {
      const job = f.job();
      const response = await request(base)
        .patch(`/api/v1/jobs/${job.id}`)
        .auth(token, { type: 'bearer' })
        .send({ targets: [{ id: job.targets[0].id, createMode: value }] })
        .expect(400);
      expect(response.body.error.details).toContainEqual({
        field: 'targets[0].createMode',
        reason: 'Invalid value',
      });
    },
  );
  /** 同 URL 的不同实例仍不能 copy，source-only PATCH 必须检查保留目标。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('rejects cross-ID copy and a source-only edit with the exact Target field', async () => {
    const job = f.job({
      targets: [{ instanceId: f.id, path: '/copy', createMode: 'server_copy' }],
    });
    for (const body of [
      { source: { instanceId: other } },
      { targets: [{ id: job.targets[0].id, instanceId: other }] },
    ]) {
      const response = await request(base)
        .patch(`/api/v1/jobs/${job.id}`)
        .auth(token, { type: 'bearer' })
        .send(body)
        .expect(400);
      expect(response.body.error.details).toContainEqual({
        field: 'targets[0].createMode',
        reason: 'Server copy requires the source Instance',
      });
    }
    expect(f.jobs().get(job.id)).toEqual(job);
  });
  /** 仅 relay 目标需要 multipart；禁用配置保存边界保持不变。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('checks multipart only on relay Targets at enable and Run acceptance', async () => {
    const db = f.app.get(DatabaseService).db;
    db.update(instances)
      .set({ multipartEnabled: false })
      .where(eq(instances.id, f.id))
      .run();
    const job = f.job({
      enabled: true,
      targets: [
        { instanceId: f.id, path: '/copy', createMode: 'server_copy' },
        { instanceId: other, path: '/relay' },
      ],
    });
    expect((await preview(f, job)).status).toBe('succeeded');
    f.jobs().setEnabled(job.id, false);
    db.update(instances)
      .set({ multipartEnabled: false })
      .where(eq(instances.id, other))
      .run();
    expect(f.jobs().patch(job.id, { name: 'Still editable' }).enabled).toBe(
      false,
    );
    for (const action of [
      () => f.jobs().setEnabled(job.id, true),
      () => f.runs().trigger(job.id, { dryRun: true, confirmDeletes: false }),
      () => f.runs().trigger(job.id, { dryRun: false, confirmDeletes: false }),
    ])
      expect(action).toThrow('Relay target requires multipart support');
    const response = await request(base)
      .patch(`/api/v1/jobs/${job.id}`)
      .auth(token, { type: 'bearer' })
      .send({ enabled: true })
      .expect(400);
    expect(response.body.error.details).toContainEqual({
      field: 'targets[1].instanceId',
      reason: 'MULTIPART_DISABLED',
    });
  });
  /** 实际发布的 OpenAPI 复用新输入/输出，Run 中两个副本均为完整 Target。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('publishes only the canonical per-Target OpenAPI shapes', async () => {
    const response = await request(base)
      .get('/api/v1/openapi.json')
      .expect(200);
    const paths = response.body.paths;
    expect(
      paths['/api/v1/jobs'].post.requestBody.content['application/json'].schema,
    ).toEqual(jobCreateSchema);
    expect(
      paths['/api/v1/jobs/{id}'].patch.requestBody.content['application/json']
        .schema,
    ).toEqual(jobPatchSchema);
    for (const schema of [jobCreateSchema, jobPatchSchema, jobViewSchema])
      expect(schema.properties).not.toHaveProperty('createMode');
    expect(jobCreateSchema).toMatchObject({
      properties: {
        targets: {
          items: {
            properties: {
              createMode: { default: 'relay', enum: ['relay', 'server_copy'] },
            },
            required: ['instanceId', 'path'],
          },
        },
      },
    });
    expect(jobViewSchema).toMatchObject({
      properties: {
        targets: {
          items: {
            required: expect.arrayContaining(['createMode']),
          },
        },
      },
    });
    expect(runDetailSchema).toMatchObject({
      properties: {
        config: {
          properties: { snapshotVersion: { enum: [1] }, job: jobViewSchema },
        },
        targets: {
          items: {
            properties: {
              config: {
                properties: {
                  target: {
                    required: expect.arrayContaining(['createMode']),
                  },
                },
              },
            },
          },
        },
      },
    });
  });
});
