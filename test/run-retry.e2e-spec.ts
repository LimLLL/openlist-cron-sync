// 通过管理员HTTP入口验证重试契约、拒绝原因和事务准入。
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { preview, terminal } from './m2-fixture.js';
import { TEST_PASSWORD, tokenOf } from './helpers.js';
import { DatabaseService } from '../src/database/database.service.js';
import { runs } from '../src/database/run-schema.js';
import { operations } from '../src/database/operation-schema.js';

let f: RelayFixture;
let base: string;
let token: string;
let parentId: string;
/** 建立有可重试历史的真实管理员会话。
 * @returns 就绪。
 * @throws Error 初始化失败。
 */
beforeEach(async () => {
  f = await relayFixture();
  base = await f.app.getUrl();
  token = tokenOf(
    (
      await request(base)
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: TEST_PASSWORD })
        .expect(200)
    ).body,
  );
  const parent = await preview(f, f.job());
  parentId = parent.id;
  const db = f.app.get(DatabaseService).db;
  db.update(runs)
    .set({ dryRun: false, status: 'failed' })
    .where(eq(runs.id, parentId))
    .run();
  db.update(operations)
    .set({ status: 'failed', endedAt: Date.now() })
    .where(eq(operations.runId, parentId))
    .run();
});
/** 释放本例资源。
 * @returns 清理完成。
 * @throws Error 清理失败。
 */
afterEach(async () => {
  await f.close();
});

/** 不接受任意路径、dryRun或错误类型，省略覆盖则false；摘要与新Run都可直接用于界面。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('exposes eligibility, validates input, and accepts a default-safe manual retry', async () => {
  await request(base)
    .post(`/api/v1/runs/${parentId}/retry`)
    .send({})
    .expect(401);
  const detail = await request(base)
    .get(`/api/v1/runs/${parentId}`)
    .auth(token, { type: 'bearer' })
    .expect(200);
  expect(detail.body.retryEligibility).toEqual({
    eligible: true,
    reason: null,
    candidateFiles: 1,
    candidateDirectories: 0,
    excludedItems: 0,
  });
  expect(detail.body).toMatchObject({
    retryOfRunId: null,
    retrySourceExists: false,
  });
  for (const body of [
    { paths: ['/target/new.txt'] },
    { dryRun: true },
    { confirmDeletes: 'true' },
    { confirmDeletes: null },
  ])
    await request(base)
      .post(`/api/v1/runs/${parentId}/retry`)
      .auth(token, { type: 'bearer' })
      .send(body)
      .expect(400);
  const accepted = await request(base)
    .post(`/api/v1/runs/${parentId}/retry`)
    .auth(token, { type: 'bearer' })
    .send({})
    .expect(202);
  expect(accepted.body).toMatchObject({
    trigger: 'manual',
    dryRun: false,
    confirmDeletes: false,
    retryOfRunId: parentId,
    retrySourceExists: true,
  });
  expect(accepted.headers.location).toBe(
    `/api/v1/runs/${accepted.body.id as string}`,
  );
  const done = await terminal(f, accepted.body.id as string);
  expect(done.status).toBe('succeeded');
  const jobs = f.jobs().list(1, 50, false);
  expect(jobs.items[0].latestTerminalRealRun).toMatchObject({
    id: done.id,
    retryOfRunId: parentId,
    retrySourceExists: true,
  });
  const rejected = await request(base)
    .post(`/api/v1/runs/${parentId}/retry`)
    .auth(token, { type: 'bearer' })
    .send({})
    .expect(409);
  expect(rejected.body.error).toMatchObject({
    code: 'RETRY_NOT_ALLOWED',
    details: [{ field: 'runId', reason: 'RUN_SUPERSEDED' }],
  });
});

/** 两个请求只有一个能接受；另一个在同一Job忙或已被新Run替代时拒绝。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('atomically admits at most one retry for the same parent', async () => {
  const responses = await Promise.all(
    [1, 2].map(() =>
      request(base)
        .post(`/api/v1/runs/${parentId}/retry`)
        .auth(token, { type: 'bearer' })
        .send({}),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([
    202, 409,
  ]);
  const accepted = responses.find((response) => response.status === 202)!;
  await terminal(f, accepted.body.id as string);
  expect(f.runs().list({ page: 1, pageSize: 50 }).total).toBe(2);
});

/** OpenAPI公布精确请求字段、来源字段和资格原因，前端无需猜测业务状态。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('publishes retry request and response schemas', async () => {
  const response = await request(base).get('/api/v1/openapi.json').expect(200);
  const document = response.body;
  expect(
    document.paths['/api/v1/runs/{id}/retry'].post.responses['202'],
  ).toBeDefined();
  expect(
    Object.keys(document.components.schemas.RetryRunDto.properties),
  ).toEqual(['confirmDeletes']);
  expect(
    document.components.schemas.RetryRunDto.properties.confirmDeletes.default,
  ).toBe(false);
  const detail =
    document.paths['/api/v1/runs/{id}'].get.responses['200'].content[
      'application/json'
    ].schema;
  expect(detail.properties.retryEligibility.properties.reason.enum).toContain(
    'HISTORY_EXPIRED',
  );
  expect(detail.properties.retrySourceExists.type).toBe('boolean');
});
