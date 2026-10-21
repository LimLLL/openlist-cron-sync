// 使用实际 Vite 产物验证 SPA、API 和静态资源之间的 HTTP 边界。
import request from 'supertest';
import { readFile } from 'node:fs/promises';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { createAppModule } from '../src/app.module.js';
import {
  applicationOptions,
  initializeApplication,
} from '../src/http-setup.js';
import { environmentFor, temporaryDirectory } from './helpers.js';
import type { TestDirectory } from './helpers.js';

/** 注册真实静态站点集成测试；test:e2e 会先构建 web。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('SPA static hosting', () => {
  let app: NestExpressApplication;
  let directory: TestDirectory;
  let html: string;

  /** 读取真实产物并启动隔离数据目录下的应用。
   * @returns 完成 Promise。
   * @throws Error 构建产物缺失或应用启动失败。
   */
  beforeAll(async () => {
    html = await readFile(
      new URL('../web/dist/index.html', import.meta.url),
      'utf8',
    );
    directory = await temporaryDirectory();
    // TestingModule 编译时尚无 HTTP adapter，serve-static 会选择 NoopLoader。
    // 使用与生产相同的 NestFactory 验证真实静态资源注册，而非替换第三方 loader。
    app = await NestFactory.create<NestExpressApplication>(
      await createAppModule(environmentFor(directory.path)),
      applicationOptions(),
    );
    await initializeApplication(app);
    await app.listen(0, '127.0.0.1');
  });

  /** 释放测试创建的应用和目录。
   * @returns 完成 Promise。
   * @throws Error 资源关闭失败。
   */
  afterAll(async () => {
    await app?.close();
    await directory?.remove();
  });

  /** 根路径和深层客户端路径均返回同一 SPA 文档。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('serves root and deep links without requiring a bearer token', async () => {
    for (const path of [
      '/',
      '/login',
      '/change-password',
      '/jobs/example',
      '/unknown-page',
      '/docs',
    ]) {
      const response = await request(app.getHttpServer())
        .get(path)
        .expect(200)
        .expect('Content-Type', /html/);
      expect(response.text).toBe(html);
      expect(response.headers['cache-control']).toContain('max-age=0');
    }
  });

  /** API、公开文档和不支持的方法不进入 HTML 回退。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('preserves API auth, JSON errors, Swagger and method boundaries', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401)
      .expect('Content-Type', /json/);
    for (const path of ['/api', '/api/'])
      await request(app.getHttpServer()).get(path).expect(404);
    for (const path of ['/api/v1/missing', '/API/v1/missing'])
      await request(app.getHttpServer())
        .get(path)
        .expect(404)
        .expect('Content-Type', /json/);
    await request(app.getHttpServer())
      .get('/api/v1/docs')
      .expect(200)
      .expect('Content-Type', /html/);
    await request(app.getHttpServer())
      .get('/api/v1/openapi.json')
      .expect(200)
      .expect('Content-Type', /json/);
    await request(app.getHttpServer()).post('/login').send({}).expect(404);
  });

  /** 资源命中返回脚本；缺失资源必须是 404，不能返回 HTML。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('serves the built script and rejects missing assets', async () => {
    const script = /src="([^"]+\.js)"/.exec(html)?.[1];
    if (!script) throw new Error('Vite entry script missing');
    await request(app.getHttpServer())
      .get(script)
      .expect(200)
      .expect('Content-Type', /javascript/);
    for (const path of [
      '/assets/missing.js',
      '/assets/missing',
      '/missing.css',
    ])
      expect(
        (await request(app.getHttpServer()).get(path).expect(404)).text,
      ).not.toContain('id="root"');
  });
});
