// 验证启停、未来时刻与严格HTTP输入，活动Run不禁止窄启停操作。
import request from 'supertest';
import { copyFixture } from './copy-fixture.js';
import type { CopyFixture } from './copy-fixture.js';
import { TEST_PASSWORD, tokenOf } from './helpers.js';
import { terminal } from './m2-fixture.js';

/** 注册M4 REST契约验收。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M4 Jobs scheduling API', () => {
  let f: CopyFixture;
  let base: string;
  let token: string;
  /** 建立已认证真实应用。
   * @param 不适用。
   * @returns 就绪。
   * @throws Error 初始化或登录失败。
   */
  beforeEach(async () => {
    f = await copyFixture();
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
  /** 关闭本例。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 关闭失败。
   */
  afterEach(async () => {
    await f.close();
  });
  /** 活动Job只允许enable/disable，snapshot及成员不改变。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('enables and disables during a Run while ordinary PATCH remains busy', async () => {
    f.initialState = 1;
    const job = f.job({
      createMode: 'server_copy',
      enabled: true,
      cron: '0 0 1 1 *',
    });
    const run = f
      .runs()
      .trigger(job.id, { dryRun: false, confirmDeletes: false });
    await request(base)
      .post(`/api/v1/jobs/${job.id}/disable`)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(200);
    await request(base)
      .patch(`/api/v1/jobs/${job.id}`)
      .auth(token, { type: 'bearer' })
      .send({ name: 'changed' })
      .expect(409);
    expect(f.runs().get(run.id).config.job.enabled).toBe(true);
    const disabled = await request(base)
      .get(`/api/v1/jobs/${job.id}/next-fire-times`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(disabled.body.times).toEqual([]);
    const enabled = await request(base)
      .post(`/api/v1/jobs/${job.id}/enable`)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(200);
    expect(enabled.body.targets).toEqual(job.targets);
    f.runs().cancel(run.id);
    await terminal(f, run.id);
  });
  /** 稀疏日期返回前缀；归档和未认证访问按现有协议拒绝。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('returns a sparse prefix and uses archived 404 consistently', async () => {
    const job = f.job({ enabled: true, cron: '0 0 29 2 *' });
    const response = await request(base)
      .get(`/api/v1/jobs/${job.id}/next-fire-times?count=20`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(response.body.times.length).toBeGreaterThan(0);
    expect(response.body.times.length).toBeLessThan(20);
    for (const count of ['0', '21', '1.5', '1e1', ''])
      await request(base)
        .get(`/api/v1/jobs/${job.id}/next-fire-times?count=${count}`)
        .auth(token, { type: 'bearer' })
        .expect(400);
    await request(base)
      .get(`/api/v1/jobs/${job.id}/next-fire-times`)
      .expect(401);
    f.jobs().archive(job.id);
    await request(base)
      .get(`/api/v1/jobs/${job.id}/next-fire-times`)
      .auth(token, { type: 'bearer' })
      .expect(404);
    for (const action of ['enable', 'disable'])
      await request(base)
        .post(`/api/v1/jobs/${job.id}/${action}`)
        .auth(token, { type: 'bearer' })
        .send({})
        .expect(404);
  });
  /** 无未来时刻、额外字段和空secret配置不能绕过启用校验。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('rejects impossible cron and extra enable fields', async () => {
    const job = f.job();
    const bad = await request(base)
      .patch(`/api/v1/jobs/${job.id}`)
      .auth(token, { type: 'bearer' })
      .send({ cron: '0 0 31 2 *' })
      .expect(400);
    expect(bad.body.error.code).toBe('INVALID_CRON');
    await request(base)
      .post(`/api/v1/jobs/${job.id}/enable`)
      .auth(token, { type: 'bearer' })
      .send({ enabled: true })
      .expect(400);
    const docs = await request(base).get('/api/v1/openapi.json').expect(200);
    expect(docs.body.paths['/api/v1/jobs/{id}/next-fire-times']).toBeDefined();
    expect(docs.body.paths['/api/v1/jobs/{id}/enable']).toBeDefined();
  });
});
