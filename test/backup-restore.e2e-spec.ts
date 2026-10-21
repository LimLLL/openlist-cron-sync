// 按部署文档的停机一致备份流程演练：禁用 Job、正常停止、复制数据目录（不含 spool）后恢复到空目录。
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import {
  constructApplication,
  environmentFor,
  startApplication,
  temporaryDirectory,
  TEST_PASSWORD,
  tokenOf,
} from './helpers.js';
import type { TestDirectory } from './helpers.js';
import { F1Server } from './openlist-fixture.js';
import { initializeApplication } from '../src/http-setup.js';

const NEW_PASSWORD = 'backup-drill-password';
const INSTANCE_TOKEN = 'backup-drill-openlist-token';

/** 用指定密码登录并返回本服务 JWT。
 * @param base 应用地址。
 * @param password 管理员密码。
 * @returns Bearer token。
 * @throws Error 登录未返回 200 或缺少 token。
 */
async function login(base: string, password: string): Promise<string> {
  const response = await request(base)
    .post('/api/v1/auth/login')
    .send({ username: 'admin', password })
    .expect(200);
  return tokenOf(response.body);
}

describe('M8 backup and restore drill', /** 注册备份恢复演练用例。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
() => {
  const directories: TestDirectory[] = [];
  let server: F1Server;

  beforeEach(
    /** 每例使用独立的 F1 上游。
     * @param 不适用。
     * @returns 启动完成。
     * @throws Error socket 失败。
     */
    async () => {
      server = await new F1Server().start();
    },
  );

  afterEach(
    /** 清理上游与本例创建的全部目录。
     * @param 不适用。
     * @returns 清理完成。
     * @throws Error 关闭或删除失败。
     */
    async () => {
      await server.close();
      for (const directory of directories.splice(0)) await directory.remove();
    },
  );

  /** 创建并登记一个测试目录。
   * @param 不适用。
   * @returns 目录资源。
   * @throws Error 文件系统失败。
   */
  async function directory(): Promise<TestDirectory> {
    const created = await temporaryDirectory();
    directories.push(created);
    return created;
  }

  /** 恢复后管理员密码、禁用的 Job 和可解密的实例凭据都来自备份；只恢复数据库而遗漏 keys.json 时拒绝启动。
   * @param 不适用。
   * @returns 断言完成。
   * @throws Error 断言或请求失败。
   */
  it('restores admin, disabled jobs and decryptable credentials; refuses a backup without keys.json', async () => {
    const live = await directory();
    const backup = await directory();
    const restored = await directory();
    const partial = await directory();

    // 原实例：改密、录入实例凭据、建立定时 Job，备份前按流程禁用。
    let app = await startApplication(environmentFor(live.path));
    let instanceId: string;
    let jobId: string;
    try {
      const base = await app.getUrl();
      await request(base)
        .post('/api/v1/auth/change-password')
        .auth(await login(base, TEST_PASSWORD), { type: 'bearer' })
        .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
        .expect(204);
      const token = await login(base, NEW_PASSWORD);
      const instance = await request(base)
        .post('/api/v1/instances')
        .auth(token, { type: 'bearer' })
        .send({
          name: 'Backup drill',
          baseUrl: server.baseUrl,
          auth: { mode: 'token', secret: INSTANCE_TOKEN },
        })
        .expect(201);
      instanceId = String(instance.body.id);
      // 启用 Job 要求端点实例已通过连接测试。
      await request(base)
        .post(`/api/v1/instances/${instanceId}/test`)
        .auth(token, { type: 'bearer' })
        .send({})
        .expect(200);
      const job = await request(base)
        .post('/api/v1/jobs')
        .auth(token, { type: 'bearer' })
        .send({
          name: 'Backup drill',
          cron: '0 3 * * *',
          source: { instanceId, path: '/source' },
          targets: [{ instanceId, path: '/target' }],
        })
        .expect(201);
      jobId = String(job.body.id);
      for (const action of ['enable', 'disable'])
        await request(base)
          .post(`/api/v1/jobs/${jobId}/${action}`)
          .auth(token, { type: 'bearer' })
          .send({})
          .expect(200);
    } finally {
      await app.close();
    }

    // 正常停止后整体复制数据目录，spool 不进入备份；再恢复到空目录。
    const spool = join(live.path, 'spool');
    await cp(live.path, backup.path, {
      recursive: true,
      filter: (path) => path !== spool,
    });
    await cp(backup.path, restored.path, { recursive: true });

    app = await startApplication(environmentFor(restored.path));
    try {
      const base = await app.getUrl();
      // 备份中的管理员已存在，ADMIN_PASSWORD 不再生效。
      await request(base)
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: TEST_PASSWORD })
        .expect(401);
      const token = await login(base, NEW_PASSWORD);
      const job = await request(base)
        .get(`/api/v1/jobs/${jobId}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(job.body).toMatchObject({ enabled: false, cron: '0 3 * * *' });
      const fires = await request(base)
        .get(`/api/v1/jobs/${jobId}/next-fire-times`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(fires.body.times).toEqual([]);
      const before = server.calls.length;
      const tested = await request(base)
        .post(`/api/v1/instances/${instanceId}/test`)
        .auth(token, { type: 'bearer' })
        .send({})
        .expect(200);
      expect(tested.body).toMatchObject({ authenticated: true });
      // 恢复的 keys.json 能解密原凭据并原样发往 OpenList。
      expect(
        server.calls
          .slice(before)
          .some((call) => call.headers.authorization === INSTANCE_TOKEN),
      ).toBe(true);
    } finally {
      await app.close();
    }

    // 只复制数据库文件、遗漏 keys.json：已有密文时不能生成替代密钥。
    await cp(join(backup.path, 'app.sqlite'), join(partial.path, 'app.sqlite'));
    const broken = await constructApplication(environmentFor(partial.path));
    await expect(initializeApplication(broken)).rejects.toMatchObject({
      code: 'KEY_MISMATCH',
    });
  });
});
