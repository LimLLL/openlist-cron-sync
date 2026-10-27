// 验证前端依赖的配额契约、名称优先级及现有操作过滤。
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { m2Fixture, preview, plan } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { TEST_PASSWORD, tokenOf } from './helpers.js';
import { DatabaseService } from '../src/database/database.service.js';
import { instances } from '../src/database/schema.js';
import { runs, runTargets } from '../src/database/run-schema.js';

describe('Job quota and operation label contract', () => {
  let f: M2Fixture;
  let base: string;
  let token: string;
  /** 建立真实API认证及已测试Instance。
   * @returns 初始化完成。
   * @throws Error 初始化失败。
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
  });
  /** 关闭本例自有服务及数据库。
   * @returns 清理完成。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    await f.close();
  });

  /** OpenAPI与实际请求/响应形状一致，供前端生成契约。
   * @returns 验证完成。
   * @throws Error HTTP或断言失败。
   */
  it('publishes the exact new quota and label fields in OpenAPI', async () => {
    const document = (
      await request(base).get('/api/v1/openapi.json').expect(200)
    ).body;
    const job =
      document.paths['/api/v1/jobs'].post.responses['201'].content[
        'application/json'
      ].schema;
    expect(job.properties.sourceDownloadConcurrency).toMatchObject({
      type: 'integer',
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      default: 2,
    });
    expect(
      job.properties.targets.items.properties.concurrentFiles,
    ).toMatchObject({ minimum: 0, default: 2 });
    expect(
      job.properties.targets.items.properties.chunkConcurrency,
    ).toMatchObject({ minimum: 1, maximum: 8, default: 2 });
    expect(
      document.components.schemas.InstanceView.properties,
    ).not.toHaveProperty('limits');
    expect(job.properties.sourceScanIntervalSeconds).toMatchObject({
      type: 'integer',
      minimum: 0,
      maximum: 3600,
      default: 0,
    });
    expect(
      job.properties.targets.items.properties.scanIntervalSeconds,
    ).toMatchObject({ type: 'integer', minimum: 0, maximum: 3600, default: 0 });
    const run = document.paths['/api/v1/runs/{id}'].get.responses;
    expect(
      run['200'].content['application/json'].schema.properties
        .sourceInstanceName.type,
    ).toBe('string');
    expect(run['500'].description).toContain('RESOURCE_LIMIT');
    const operation =
      document.paths['/api/v1/operations/{id}'].get.responses['200'].content[
        'application/json'
      ].schema;
    expect(operation.properties.sourceInstanceName).toMatchObject({
      type: 'string',
      nullable: true,
    });
    expect(operation.properties.targetInstanceName).toEqual({ type: 'string' });
  });

  /** 新值默认2，PATCH省略保留，0仅适用于文件配额。
   * @returns 验证完成。
   * @throws Error HTTP或断言失败。
   */
  it('exposes defaults, preserves PATCH omissions, and rejects removed and invalid fields', async () => {
    const created = await request(base)
      .post('/api/v1/jobs')
      .auth(token, { type: 'bearer' })
      .send({
        name: 'Quotas',
        source: { instanceId: f.id, path: '/source' },
        targets: [{ instanceId: f.id, path: '/target' }],
      })
      .expect(201);
    expect(created.body).toMatchObject({
      sourceDownloadConcurrency: 2,
      sourceScanIntervalSeconds: 0,
      targets: [
        { concurrentFiles: 2, chunkConcurrency: 2, scanIntervalSeconds: 0 },
      ],
    });
    const id = created.body.id as string;
    const targetId = f.jobs().get(id).targets[0].id;
    await request(base)
      .patch(`/api/v1/jobs/${id}`)
      .auth(token, { type: 'bearer' })
      .send({
        sourceDownloadConcurrency: 0,
        targets: [{ id: targetId, concurrentFiles: 0, chunkConcurrency: 8 }],
      })
      .expect(200);
    const changed = await request(base)
      .patch(`/api/v1/jobs/${id}`)
      .auth(token, { type: 'bearer' })
      .send({
        name: 'Preserved',
        targets: [{ id: targetId }, { instanceId: f.id, path: '/second' }],
      })
      .expect(200);
    expect(changed.body).toMatchObject({
      sourceDownloadConcurrency: 0,
      targets: [
        { concurrentFiles: 0, chunkConcurrency: 8 },
        { concurrentFiles: 2, chunkConcurrency: 2 },
      ],
    });
    for (const value of [null, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) {
      await request(base)
        .patch(`/api/v1/jobs/${id}`)
        .auth(token, { type: 'bearer' })
        .send({ sourceDownloadConcurrency: value })
        .expect(400);
      await request(base)
        .patch(`/api/v1/jobs/${id}`)
        .auth(token, { type: 'bearer' })
        .send({ targets: [{ id: targetId, concurrentFiles: value }] })
        .expect(400);
    }
    for (const value of [null, 0, 9, 1.5, '2'])
      await request(base)
        .patch(`/api/v1/jobs/${id}`)
        .auth(token, { type: 'bearer' })
        .send({ targets: [{ id: targetId, chunkConcurrency: value }] })
        .expect(400);
    for (const key of [
      'maxApiConcurrency',
      'apiRequestsPerSecond',
      'maxDownloadConnections',
      'maxUploadSessions',
      'maxOutstandingTasks',
      'maxChunkConcurrency',
    ])
      await request(base)
        .patch(`/api/v1/instances/${f.id}`)
        .auth(token, { type: 'bearer' })
        .send({ limits: { [key]: 2 } })
        .expect(400);
    const instance = await request(base)
      .get(`/api/v1/instances/${f.id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(instance.body).not.toHaveProperty('limits');
  });

  /** interval 输入、PATCH 合并和历史 Run 冻结与公开 schema 一致。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error HTTP 或断言失败。
   */
  it('validates scan intervals, preserves omissions, clears zero and freezes snapshots', async () => {
    const job = f.job();
    const targetId = job.targets[0].id;
    const url = `/api/v1/jobs/${job.id}`;
    await request(base)
      .patch(url)
      .auth(token, { type: 'bearer' })
      .send({
        sourceScanIntervalSeconds: 3600,
        targets: [{ id: targetId, scanIntervalSeconds: 7 }],
      })
      .expect(200);
    const kept = await request(base)
      .patch(url)
      .auth(token, { type: 'bearer' })
      .send({ name: 'Keep interval', targets: [{ id: targetId }] })
      .expect(200);
    expect(kept.body).toMatchObject({
      sourceScanIntervalSeconds: 3600,
      targets: [{ scanIntervalSeconds: 7 }],
    });
    for (const value of [null, -1, 1.5, '1', 3601]) {
      for (const input of [
        { sourceScanIntervalSeconds: value },
        { targets: [{ id: targetId, scanIntervalSeconds: value }] },
      ]) {
        const rejected = await request(base)
          .patch(url)
          .auth(token, { type: 'bearer' })
          .send(input)
          .expect(400);
        expect(rejected.body.error.code).toBe('VALIDATION_ERROR');
      }
    }
    const cleared = await request(base)
      .patch(url)
      .auth(token, { type: 'bearer' })
      .send({
        sourceScanIntervalSeconds: 0,
        targets: [{ id: targetId, scanIntervalSeconds: 0 }],
      })
      .expect(200);
    expect(cleared.body).toMatchObject({
      sourceScanIntervalSeconds: 0,
      targets: [{ scanIntervalSeconds: 0 }],
    });
    const run = await preview(f, f.jobs().get(job.id));
    await request(base)
      .patch(url)
      .auth(token, { type: 'bearer' })
      .send({
        sourceScanIntervalSeconds: 3,
        targets: [{ id: targetId, scanIntervalSeconds: 2 }],
      })
      .expect(200);
    const frozen = await request(base)
      .get(`/api/v1/runs/${run.id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(frozen.body.config.job).toMatchObject({
      sourceScanIntervalSeconds: 0,
      targets: [{ scanIntervalSeconds: 0 }],
    });
    expect(frozen.body.targets[0].config.target.scanIntervalSeconds).toBe(0);
    expect(frozen.body.targets[0].config.instance).not.toHaveProperty('limits');
    expect(frozen.body.config.instances[f.id]).not.toHaveProperty('limits');
  });

  /** 所有操作响应和Run目标名称使用冻结值，缺失才查含归档的当前Instance。
   * @returns 验证完成。
   * @throws Error SQL、HTTP或断言失败。
   */
  it('resolves frozen names, archived fallback and Instance ID prefixes on detail and pages', async () => {
    const run = await preview(f, f.job());
    const op = plan(f, run.id)[0];
    const db = f.app.get(DatabaseService).db;
    db.update(instances)
      .set({ name: 'Renamed', archivedAt: Date.now() })
      .where(eq(instances.id, f.id))
      .run();
    for (const path of [
      `/api/v1/operations/${op.id}`,
      `/api/v1/runs/${run.id}/operations?status=pending&action=create`,
      '/api/v1/operations?status=pending',
    ]) {
      const response = await request(base)
        .get(path)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(
        path.includes('?') ? response.body.items[0] : response.body,
      ).toMatchObject({
        sourceInstanceId: f.id,
        targetInstanceId: f.id,
        sourceInstanceName: 'Fixture',
        targetInstanceName: 'Fixture',
      });
    }
    expect(f.runs().get(run.id)).toMatchObject({
      sourceInstanceName: 'Fixture',
      targets: [{ instanceName: 'Fixture' }],
    });
    const row = f.runs().record(run.id);
    row.config.instances[f.id].name = '';
    db.update(runs)
      .set({ config: row.config })
      .where(eq(runs.id, run.id))
      .run();
    const target = db
      .select()
      .from(runTargets)
      .where(eq(runTargets.runId, run.id))
      .get();
    if (!target) throw new Error('Missing target');
    target.config.instance.name = '';
    db.update(runTargets)
      .set({ config: target.config })
      .where(eq(runTargets.id, target.id))
      .run();
    expect(plan(f, run.id)[0]).toMatchObject({
      sourceInstanceName: 'Renamed',
      targetInstanceName: 'Renamed',
    });
    expect(f.runs().get(run.id)).toMatchObject({
      sourceInstanceName: 'Renamed',
      targets: [{ instanceName: 'Renamed' }],
    });
    const missing = randomUUID();
    target.config.target.instanceId = missing;
    db.update(runTargets)
      .set({ config: target.config })
      .where(eq(runTargets.id, target.id))
      .run();
    expect(f.runs().get(run.id).targets[0].instanceName).toBe(
      missing.slice(0, 8),
    );
    const empty = await request(base)
      .get(`/api/v1/runs/${run.id}/operations?status=failed&action=create`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(empty.body.total).toBe(0);
  });
});
