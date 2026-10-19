// 验证真实认证路由、密码撤销、并发改密和限流响应。
import request from 'supertest';
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { KeysService } from '../src/security/keys.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { LoginLimiter } from '../src/security/login-limiter.js';
import {
  environmentFor,
  startApplication,
  temporaryDirectory,
  TEST_PASSWORD,
  tokenOf,
} from './helpers.js';
import type { TestDirectory } from './helpers.js';

/** 若重启读取 bootstrap 字段，立即失败。
 * @param 不适用。
 * @returns 不返回。
 * @throws Error 始终抛出。
 */
function bootstrapAccessForbidden(): never {
  throw new Error('Bootstrap environment must not be read');
}

/** 注册认证端到端测试。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M0 authentication', () => {
  let directory: TestDirectory;
  let app: NestExpressApplication<Server> | undefined;

  /** 创建独立目录。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 文件系统失败。
   */
  beforeEach(async () => {
    directory = await temporaryDirectory();
  });

  /** 释放全部资源。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    await directory.remove();
    vi.restoreAllMocks();
  });

  /** 改密立即并跨重启撤销 JWT；已有管理员阻止 bootstrap 环境访问。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('revokes old JWTs and never reads bootstrap credentials on restart', async () => {
    app = await startApplication(environmentFor(directory.path));
    let server = app.getHttpServer();
    const old = tokenOf(
      (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ username: 'admin', password: TEST_PASSWORD })
          .expect(200)
      ).body,
    );
    await request(server)
      .get('/api/v1/auth/me')
      .auth(old, { type: 'bearer' })
      .expect(200, { id: 1, username: 'admin', mustChangePassword: false });
    const newPassword = 'new-administrator-password';
    await request(server)
      .post('/api/v1/auth/change-password')
      .auth(old, { type: 'bearer' })
      .send({ currentPassword: TEST_PASSWORD, newPassword })
      .expect(204, '');
    await request(server)
      .get('/api/v1/auth/me')
      .auth(old, { type: 'bearer' })
      .expect(401);
    const stored = app.get(DatabaseService).admin();
    expect(stored?.tokenVersion).toBe(2);
    expect(stored?.passwordHash).not.toContain(newPassword);
    await app.close();
    const env = environmentFor(directory.path);
    Object.defineProperties(env, {
      ADMIN_USERNAME: { get: bootstrapAccessForbidden },
      ADMIN_PASSWORD: { get: bootstrapAccessForbidden },
    });
    app = await startApplication(env);
    server = app.getHttpServer();
    await request(server)
      .get('/api/v1/auth/me')
      .auth(old, { type: 'bearer' })
      .expect(401);
    await request(server)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: newPassword })
      .expect(200);
    expect(app.get(DatabaseService).admin()).toEqual(stored);
  });

  /** 同时改密只允许一个旧版本提交。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('allows exactly one concurrent change against the same token version', async () => {
    app = await startApplication(environmentFor(directory.path));
    const server = app.getHttpServer();
    const token = tokenOf(
      (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ username: 'admin', password: TEST_PASSWORD })
          .expect(200)
      ).body,
    );
    const responses = await Promise.all([
      request(server)
        .post('/api/v1/auth/change-password')
        .auth(token, { type: 'bearer' })
        .send({
          currentPassword: TEST_PASSWORD,
          newPassword: 'new-password-one',
        }),
      request(server)
        .post('/api/v1/auth/change-password')
        .auth(token, { type: 'bearer' })
        .send({
          currentPassword: TEST_PASSWORD,
          newPassword: 'new-password-two',
        }),
    ]);
    expect(responses.map(statusOf).sort()).toEqual([204, 401]);
    expect(app.get(DatabaseService).admin()?.tokenVersion).toBe(2);
  });

  /** 固定算法、受众和必要 claims 均由真实 guard 验证。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('rejects invalid JWT claims and algorithms', async () => {
    app = await startApplication(environmentFor(directory.path));
    const jwt = new JwtService();
    const key = app.get(KeysService).jwtSecret;
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sub: '1',
      ver: 1,
      iss: 'openlist-cron-sync',
      aud: 'admin-api',
      iat: now,
      exp: now + 300,
    };
    for (const changes of [
      { sub: '2' },
      { iss: 'other' },
      { aud: 'other' },
      { ver: '1' },
      { exp: now - 60 },
      { iat: now + 60 },
    ]) {
      const token = jwt.sign(
        { ...claims, ...changes },
        { secret: key, algorithm: 'HS256' },
      );
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .auth(token, { type: 'bearer' })
        .expect(401);
    }
    const wrongAlgorithm = jwt.sign(claims, {
      secret: key,
      algorithm: 'HS384',
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .auth(wrongAlgorithm, { type: 'bearer' })
      .expect(401);
    const noExpiry = jwt.sign(
      { sub: '1', ver: 1, iss: 'openlist-cron-sync', aud: 'admin-api' },
      { secret: key, algorithm: 'HS256' },
    );
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .auth(noExpiry, { type: 'bearer' })
      .expect(401);
  });

  /** 五次失败后返回 429，拒绝路径不调用密码校验。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('returns exact rate-limit status and shares failures with password changes', async () => {
    app = await startApplication(environmentFor(directory.path));
    const server = app.getHttpServer();
    const token = tokenOf(
      (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ username: 'admin', password: TEST_PASSWORD })
          .expect(200)
      ).body,
    );
    await request(server)
      .post('/api/v1/auth/change-password')
      .auth(token, { type: 'bearer' })
      .send({
        currentPassword: 'incorrect-password',
        newPassword: 'valid-new-password',
      })
      .expect(401);
    for (let attempt = 0; attempt < 4; attempt++)
      await request(server)
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: 'incorrect-password' })
        .expect(401);
    const read = vi.spyOn(app.get(DatabaseService), 'admin');
    const limited = await request(server)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: TEST_PASSWORD })
      .expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(read).not.toHaveBeenCalled();
    expect(limited.body).toMatchObject({
      error: { code: 'LOGIN_RATE_LIMITED' },
    });
  });

  /** 只有明确配置的代理跳数才能影响 IP 窗口。
   * @param hops 可信代理跳数。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it.each([0, 1])(
    'honours TRUST_PROXY_HOPS=%s for the IP limiter',
    async (hops) => {
      app = await startApplication(
        environmentFor(directory.path, {
          TRUST_PROXY_HOPS: String(hops),
          LOGIN_MAX_FAILURES: '1',
        }),
      );
      const server = app.getHttpServer();
      await request(server)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '192.0.2.1')
        .send({ username: 'unknown-one', password: TEST_PASSWORD })
        .expect(401);
      await request(server)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '192.0.2.2')
        .send({ username: 'unknown-two', password: TEST_PASSWORD })
        .expect(hops === 0 ? 429 : 401);
    },
  );

  /** 容量不足也经统一错误输出返回 Retry-After: 1。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('rejects capacity without touching administrator data', async () => {
    app = await startApplication(environmentFor(directory.path));
    const limiter = app.get(LoginLimiter);
    limiter.enter('a', 'a');
    limiter.enter('b', 'b');
    try {
      const read = vi.spyOn(app.get(DatabaseService), 'admin');
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: TEST_PASSWORD })
        .expect(429);
      expect(response.headers['retry-after']).toBe('1');
      expect(read).not.toHaveBeenCalled();
    } finally {
      limiter.leave();
      limiter.leave();
    }
  });
});

/** 提取 HTTP 状态。
 * @param response supertest 响应。
 * @returns HTTP 状态码。
 * @throws 不适用。
 */
function statusOf(response: request.Response): number {
  return response.status;
}
