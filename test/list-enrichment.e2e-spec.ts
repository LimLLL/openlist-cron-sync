// 验证列表扩展的真实HTTP响应、查询校验、OpenAPI边界和错误语义。
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { CronTime } from 'cron';
import { DatabaseService } from '../src/database/database.service.js';
import { jobs } from '../src/database/job-schema.js';
import { runs } from '../src/database/run-schema.js';
import { operations } from '../src/database/operation-schema.js';
import { ACTIVE_RUN_STATUSES } from '../src/runs/run-types.js';
import { object } from '../src/openlist/errors.js';
import { m2Fixture, preview } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { seedListRun } from './list-fixture.js';
import { TEST_PASSWORD, tokenOf } from './helpers.js';

/** 从公开OpenAPI文档读取指定响应的内联schema。
 * @param document 未信任的JSON文档。
 * @param path API路径模板。
 * @param status 响应码。
 * @param method HTTP方法。
 * @returns 内联响应schema。
 * @throws Error 文档结构不符合预期。
 */
function responseSchema(
  document: unknown,
  path: string,
  status: string,
  method = 'get',
) {
  const operation = object(object(object(document).paths)[path]);
  const responses = object(object(operation[method]).responses);
  const content = object(object(responses[status]).content);
  return object(object(content['application/json']).schema);
}

describe('list enrichment HTTP contracts', () => {
  let f: M2Fixture;
  let base: string;
  let token: string;
  /** 建立真实HTTP服务和管理员会话。
   * @returns 初始化完成。
   * @throws Error 启动或认证失败。
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
  /** 恢复故障注入并释放本例自有服务。
   * @returns 清理完成。
   * @throws Error 关闭失败。
   */
  afterEach(async () => {
    vi.restoreAllMocks();
    await f.close();
  });

  /** 列表显式扩展schema，配置/快照和触发响应不包含列表字段或active状态。
   * @returns 验证完成。
   * @throws Error 请求或断言失败。
   */
  it('publishes separate closed list schemas without changing Job snapshots or Run statuses', async () => {
    const document: unknown = (
      await request(base).get('/api/v1/openapi.json').expect(200)
    ).body;
    const job = responseSchema(document, '/api/v1/jobs', '201', 'post');
    const jobList = object(
      object(responseSchema(document, '/api/v1/jobs', '200').properties).items,
    );
    const item = object(jobList.items);
    const properties = object(item.properties);
    expect(item.additionalProperties).toBe(false);
    expect(item).not.toHaveProperty('allOf');
    expect(Object.keys(properties).sort()).toEqual(
      [
        ...Object.keys(object(job.properties)),
        'latestTerminalRealRun',
        'nextFireAt',
        'scheduleError',
      ].sort(),
    );
    expect(item.required).toEqual(
      expect.arrayContaining([
        'latestTerminalRealRun',
        'nextFireAt',
        'scheduleError',
      ]),
    );
    const summary = object(properties.latestTerminalRealRun);
    expect(summary).toMatchObject({
      nullable: true,
      additionalProperties: false,
    });
    expect(summary.required).toEqual([
      'id',
      'status',
      'createdAt',
      'startedAt',
      'endedAt',
      'stopReason',
      'error',
    ]);
    expect(object(summary.properties).endedAt).toEqual({
      type: 'string',
      format: 'date-time',
    });
    expect(object(summary.properties)).not.toHaveProperty('stats');
    expect(properties.nextFireAt).toMatchObject({
      nullable: true,
      format: 'date-time',
    });
    expect(properties.scheduleError).toMatchObject({
      nullable: true,
      properties: {
        code: {
          enum: ['INVALID_TIMEZONE', 'INVALID_CRON', 'NO_NEXT_OCCURRENCE'],
        },
      },
    });
    const detail = responseSchema(document, '/api/v1/runs/{id}', '200');
    const config = object(object(detail.properties).config);
    expect(object(config.properties).job).toEqual(job);
    expect(object(config.properties).snapshotVersion).toEqual({
      type: 'integer',
      enum: [1],
    });
    const runPage = responseSchema(document, '/api/v1/runs', '200');
    const runItem = object(object(object(runPage.properties).items).items);
    expect(runItem.required).toEqual(expect.arrayContaining(['jobName']));
    expect(object(object(runItem.properties).status).enum).not.toContain(
      'active',
    );
    expect(
      object(
        responseSchema(document, '/api/v1/jobs/{id}/runs', '202', 'post')
          .properties,
      ),
    ).not.toHaveProperty('jobName');
    const runGet = object(object(object(document).paths)['/api/v1/runs']);
    expect(object(runGet.get).parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'status',
          schema: expect.objectContaining({
            enum: expect.arrayContaining(['active']),
          }),
        }),
      ]),
    );
    expect(
      object(object(object(runGet.get).responses)['500']).description,
    ).toContain('RESOURCE_LIMIT');
  });

  /** HTTP列表公开精简摘要和冻结名称；详情配置及Run快照仍为原始Job形状。
   * @returns 验证完成。
   * @throws Error 请求或断言失败。
   */
  it('serializes the terminal real summary and frozen name while preserving config and snapshot responses', async () => {
    const job = f.job({
      name: 'Frozen',
      source: {
        instanceId: f.id,
        path: '/source',
        password: 'PRIVATE_PATH_PASSWORD',
      },
    });
    const run = seedListRun(f, job, {
      status: 'cancelled',
      stopReason: 'RUN_TIMEOUT',
      createdAt: 100,
    });
    seedListRun(f, job, { dryRun: true, createdAt: 200 });
    const empty = f.job();
    f.jobs().patch(job.id, { name: 'Renamed' });
    const listed = await request(base)
      .get('/api/v1/jobs')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(listed.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: job.id,
          name: 'Renamed',
          nextFireAt: null,
          scheduleError: null,
          latestTerminalRealRun: {
            id: run.id,
            status: 'cancelled',
            stopReason: 'RUN_TIMEOUT',
            createdAt: new Date(100).toISOString(),
            startedAt: null,
            endedAt: new Date(101).toISOString(),
            error: null,
          },
        }),
        expect.objectContaining({ id: empty.id, latestTerminalRealRun: null }),
      ]),
    );
    expect(listed.text).not.toMatch(
      /PRIVATE_PATH_PASSWORD|secretSnapshotEnc|sourcePasswordEnc/,
    );
    const current = await request(base)
      .get(`/api/v1/jobs/${job.id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(current.body).not.toHaveProperty('latestTerminalRealRun');
    const detail = await request(base)
      .get(`/api/v1/runs/${run.id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(detail.body.config).toMatchObject({ snapshotVersion: 1, job });
    expect(detail.body.config.job).not.toHaveProperty('nextFireAt');
    f.jobs().archive(job.id);
    const history = await request(base)
      .get(`/api/v1/runs?jobId=${job.id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(history.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: run.id, jobName: 'Frozen' }),
      ]),
    );
    const archived = await request(base)
      .get('/api/v1/jobs?includeArchived=true')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(archived.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: job.id,
          nextFireAt: null,
          scheduleError: null,
          latestTerminalRealRun: expect.objectContaining({
            id: run.id,
            stopReason: 'RUN_TIMEOUT',
          }),
        }),
      ]),
    );
  });

  /** active只扩展查询枚举，并可组合Job、预览和分页条件。
   * @returns 验证完成。
   * @throws Error 请求或断言失败。
   */
  it('accepts active with existing filters and rejects invalid query values', async () => {
    const records = ACTIVE_RUN_STATUSES.map((status, index) =>
      seedListRun(f, f.job(), {
        status,
        dryRun: index % 2 === 0,
        createdAt: 100 + index,
      }),
    );
    seedListRun(f, f.job());
    const all = await request(base)
      .get('/api/v1/runs?status=active&pageSize=200')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(all.body.total).toBe(6);
    expect(
      new Set(
        (all.body.items as { status: string }[]).map((run) => run.status),
      ),
    ).toEqual(new Set(ACTIVE_RUN_STATUSES));
    const page = await request(base)
      .get('/api/v1/runs?status=active&dryRun=true&pageSize=1&page=2')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(page.body).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 3,
      items: [{ id: records[2].id }],
    });
    const job = await request(base)
      .get(`/api/v1/runs?status=active&dryRun=false&jobId=${records[1].jobId}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(job.body).toMatchObject({
      total: 1,
      items: [{ id: records[1].id }],
    });
    for (const query of [
      'status=ACTIVE',
      'status=active,failed',
      'status=unknown',
      'status=active&dryRun=1',
    ])
      await request(base)
        .get(`/api/v1/runs?${query}`)
        .auth(token, { type: 'bearer' })
        .expect(400);
  });

  /** 已知调度错误不破坏其他行，意外cron故障必须成为HTTP错误。
   * @returns 验证完成。
   * @throws Error 请求或断言失败。
   */
  it('returns schedule diagnostics but fails the request for unexpected calculation errors', async () => {
    const db = f.app.get(DatabaseService).db;
    const valid = f.job();
    const invalid = f.job();
    db.update(jobs)
      .set({ enabled: true, cron: '* * * * *' })
      .where(eq(jobs.id, valid.id))
      .run();
    db.update(jobs)
      .set({ enabled: true, cron: '* * * * *', timezone: 'Invalid/Timezone' })
      .where(eq(jobs.id, invalid.id))
      .run();
    const response = await request(base)
      .get('/api/v1/jobs')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: valid.id,
          nextFireAt: expect.any(String),
          scheduleError: null,
        }),
        expect.objectContaining({
          id: invalid.id,
          nextFireAt: null,
          scheduleError: {
            code: 'INVALID_TIMEZONE',
            message: 'Invalid schedule timezone',
          },
        }),
      ]),
    );
    vi.spyOn(CronTime.prototype, 'getNextDateFrom').mockImplementation(() => {
      throw new Error('Unexpected calculator failure');
    });
    const failed = await request(base)
      .get('/api/v1/jobs')
      .auth(token, { type: 'bearer' })
      .expect(500);
    expect(failed.body.error.code).toBe('INTERNAL_ERROR');
    expect(failed.text).not.toContain('Unexpected calculator failure');
  });

  /** 列表统计溢出与详情同为RESOURCE_LIMIT，页外运行不聚合且读取不改写状态。
   * @returns 验证完成。
   * @throws Error 请求或断言失败。
   */
  it('exposes live-stat overflow consistently without changing run state', async () => {
    const run = await preview(f, f.job());
    const db = f.app.get(DatabaseService).db;
    const operation = db
      .select()
      .from(operations)
      .where(eq(operations.runId, run.id))
      .get()!;
    db.update(operations)
      .set({ bytesTransferred: Number.MAX_SAFE_INTEGER })
      .where(eq(operations.id, operation.id))
      .run();
    db.insert(operations)
      .values({
        ...operation,
        id: randomUUID(),
        seq: operation.seq + 1,
        bytesTransferred: 1,
      })
      .run();
    db.update(runs)
      .set({ status: 'executing', dryRun: false, endedAt: null })
      .where(eq(runs.id, run.id))
      .run();
    const before = f.runs().record(run.id);
    for (const path of ['/runs', `/runs/${run.id}`]) {
      const response = await request(base)
        .get(`/api/v1${path}`)
        .auth(token, { type: 'bearer' })
        .expect(500);
      expect(response.body.error.code).toBe('RESOURCE_LIMIT');
    }
    const empty = await request(base)
      .get('/api/v1/runs?page=2&pageSize=1')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(empty.body).toMatchObject({ items: [], total: 1 });
    await request(base)
      .get('/api/v1/jobs')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(f.runs().record(run.id)).toEqual(before);
  });
});
