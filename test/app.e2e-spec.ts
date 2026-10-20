// 通过真实 HTTP 验证初始化、公开文档及错误契约。
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { AppConfig } from '../src/configuration/app-config.js';
import { DatabaseService } from '../src/database/database.service.js';
import { Readiness } from '../src/coordination/coordination.module.js';
import { initializeApplication } from '../src/http-setup.js';
import {
  constructApplication,
  environmentFor,
  startApplication,
  temporaryDirectory,
  TEST_PASSWORD,
  tokenOf,
} from './helpers.js';
import type { TestDirectory } from './helpers.js';

/** 注册 HTTP 契约测试。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M0 HTTP', () => {
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

  /** 关闭应用再清理目录。
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

  /** 验证实际 DI、ready、公开文档和认证边界。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('initializes through Nest hooks and exposes the agreed public routes', async () => {
    app = await constructApplication(environmentFor(directory.path));
    const readiness = app.get(Readiness);
    expect(readiness.ready).toBe(false);
    await initializeApplication(app);
    expect(app.get(DatabaseService).admin()?.username).toBe('admin');
    const database = app.get(DatabaseService).db;
    expect(database.get(sql`PRAGMA journal_mode`)).toEqual({
      journal_mode: 'wal',
    });
    expect(database.get(sql`PRAGMA synchronous`)).toEqual({ synchronous: 2 });
    expect(database.get(sql`PRAGMA foreign_keys`)).toEqual({ foreign_keys: 1 });
    expect(database.get(sql`PRAGMA busy_timeout`)).toEqual({ timeout: 5000 });
    expect(readiness.ready).toBe(false);
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer();
    await request(server)
      .get('/api/v1/system/health/live')
      .expect(200, { status: 'ok' });
    await request(server)
      .get('/api/v1/system/health/ready')
      .expect(200, { status: 'ok', database: 'ok' });
    await request(server).get('/api/v1/auth/me').expect(401);
    await request(server)
      .post('/api/v1/auth/change-password')
      .send({})
      .expect(401);
    await request(server).get('/api/v1/docs').expect(200);
    const schema = await request(server)
      .get('/api/v1/openapi.json')
      .expect(200);
    expect(schema.text).toContain('/api/v1/auth/login');
    expect(schema.text).not.toMatch(
      /password_hash|secret_enc|schedulerReady|token_version/,
    );
    for (const path of ['/docs', '/api/v1/docs-json', '/api/v1/docs-yaml'])
      await request(server).get(path).expect(404);
    readiness.ready = false;
    await request(server)
      .get('/api/v1/system/health/ready')
      .expect(503, { status: 'not_ready', database: 'ok' });
    await app.close();
    expect(readiness.ready).toBe(false);
    expect(app.get(DatabaseService).healthy()).toBe(false);
    expect((await stat(directory.path)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory.path, 'keys.json'))).mode & 0o777).toBe(
      0o600,
    );
  });

  /** 验证 DTO 元数据、body 限制和不回显输入的错误体。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('rejects invalid input without reflecting secrets', async () => {
    app = await startApplication(environmentFor(directory.path));
    const server = app.getHttpServer();
    const secret = 'secret-that-must-never-be-reflected';
    for (const body of [
      { username: 'admin', password: secret, extra: secret },
      { username: 'admin', password: 123 },
      {},
      [],
    ]) {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .set('X-Request-Id', secret)
        .send(body)
        .expect(400);
      expect(response.text).not.toContain(secret);
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.body).toMatchObject({
        error: { code: 'VALIDATION_ERROR', details: expect.any(Array) },
        requestId: response.headers['x-request-id'],
      });
    }
    for (const raw of [
      `{"username":"admin","password":"${TEST_PASSWORD}","__proto__":{}}`,
      `{"username":"admin","password":"${TEST_PASSWORD}","constructor":{}}`,
    ])
      await request(server)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send(raw)
        .expect(400);
    for (const [header, value] of [
      ['Content-Type', 'application/json; charset=x-unsupported'],
      ['Content-Encoding', 'x-unsupported'],
    ])
      await request(server)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .set(header, value)
        .send('{}')
        .expect(400);
    const malformed = await request(server)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(`{"password":"${secret}"`)
      .expect(400);
    expect(malformed.text).not.toContain(secret);
    const oversized = await request(server)
      .post('/api/v1/auth/login')
      .send({ password: 'x'.repeat(1024 * 1024) })
      .expect(413);
    expect(oversized.body).toMatchObject({
      error: { code: 'PAYLOAD_TOO_LARGE' },
    });
    for (const query of ['unexpected=true', 'constructor=x', '__proto__=x'])
      await request(server)
        .get(`/api/v1/system/health/live?${query}`)
        .expect(400);
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: TEST_PASSWORD })
      .expect(200);
    await request(server)
      .get('/api/v1/auth/me?unexpected=true')
      .auth(tokenOf(login.body), { type: 'bearer' })
      .expect(400);
  });

  /** 不同实例分别读取配置，未来里程碑配置不被消费。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('keeps application environments independent', async () => {
    app = await startApplication(environmentFor(directory.path, {}));
    const otherDirectory = await temporaryDirectory();
    try {
      const other = await startApplication(
        environmentFor(otherDirectory.path, {
          API_DOCS_ENABLED: 'false',
          ADMIN_USERNAME: 'second',
        }),
      );
      try {
        expect(app.get(AppConfig).apiDocsEnabled).toBe(true);
        expect(other.get(AppConfig).apiDocsEnabled).toBe(false);
        expect(app.get(DatabaseService).admin()?.username).toBe('admin');
        expect(other.get(DatabaseService).admin()?.username).toBe('second');
        expect(app.get(ConfigService)).not.toBe(other.get(ConfigService));
        await request(other.getHttpServer()).get('/api/v1/docs').expect(404);
        await request(other.getHttpServer())
          .get('/api/v1/openapi.json')
          .expect(404);
        await request(app.getHttpServer())
          .get('/api/v1/openapi.json')
          .expect(200);
      } finally {
        await other.close();
      }
    } finally {
      await otherDirectory.remove();
    }
  });
});
