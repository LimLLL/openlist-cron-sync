// 验证首次密码输出、强制改密边界以及异步登录期间的密码竞争。
import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import request from 'supertest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAppModule } from '../src/app.module.js';
import {
  applicationOptions,
  initializeApplication,
} from '../src/http-setup.js';
import { AuthService } from '../src/security/auth.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import * as passwords from '../src/security/passwords.js';
import {
  environmentFor,
  startApplication,
  temporaryDirectory,
  TEST_PASSWORD,
  tokenOf,
} from './helpers.js';
import type { TestDirectory } from './helpers.js';

/** 仅用于测试默认 guard 的受保护路由，不进入生产应用。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Controller('test-protected')
class ProtectedController {
  /** 普通管理操作，强制改密 JWT 不允许访问。
   * @param 不适用。
   * @returns 成功标志。
   * @throws 不适用。
   */
  @Get()
  read(): { ok: boolean } {
    return { ok: true };
  }

  /** 注入带秘密的内部错误以验证过滤边界。
   * @param 不适用。
   * @returns 不返回。
   * @throws TypeError 各字段包含测试秘密的内部异常。
   */
  @Get('failure')
  fail(): never {
    throw Object.assign(new TypeError('upstream-password-secret'), {
      name: 'upstream-name-secret',
      code: 'UPSTREAM_PRIVATE_TOKEN',
    });
  }
}

/** 注册 bootstrap 和并发用例。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('bootstrap and password races', () => {
  let directory: TestDirectory;
  let app: NestExpressApplication<Server> | undefined;

  /** 创建目录。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 文件系统失败。
   */
  beforeEach(async () => {
    directory = await temporaryDirectory();
  });

  /** 释放应用和测试资源。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    vi.restoreAllMocks();
    await directory.remove();
  });

  /** 随机密码只输出一次，且受限 token 不能调用普通管理端点。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('prints once to stderr and enforces mandatory password change', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(
      /** 捕获输出并完成 write 回调。
       * @param chunk 字符串或二进制内容。
       * @param arguments_ 编码或完成回调。
       * @returns 写入成功。
       * @throws 不适用。
       */
      (chunk, ...arguments_) => {
        chunks.push(String(chunk));
        for (const argument of arguments_)
          if (typeof argument === 'function') argument();
        return true;
      },
    );
    const module = await Test.createTestingModule({
      imports: [
        await createAppModule(
          environmentFor(directory.path, { ADMIN_PASSWORD: undefined }),
        ),
      ],
      controllers: [ProtectedController],
    }).compile();
    app =
      module.createNestApplication<NestExpressApplication<Server>>(
        applicationOptions(),
      );
    await initializeApplication(app);
    await app.listen(0, '127.0.0.1');
    const output = chunks.join('');
    const password =
      /Initial administrator password \(change immediately\): ([A-Za-z0-9_-]+)/.exec(
        output,
      )?.[1];
    expect(password).toBeDefined();
    if (!password) throw new Error('Missing bootstrap notice');
    expect(Buffer.from(password, 'base64url').length).toBeGreaterThanOrEqual(
      24,
    );
    const server = app.getHttpServer();
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password })
      .expect(200);
    expect(login.body).toMatchObject({ mustChangePassword: true });
    const token = tokenOf(login.body);
    await request(server).get('/api/v1/test-protected').expect(401);
    await request(server)
      .get('/api/v1/test-protected')
      .auth(token, { type: 'bearer' })
      .expect(403);
    await request(server)
      .get('/api/v1/auth/me')
      .auth(token, { type: 'bearer' })
      .expect(200);
    await request(server)
      .post('/api/v1/auth/change-password')
      .auth(token, { type: 'bearer' })
      .send({ currentPassword: password, newPassword: TEST_PASSWORD })
      .expect(204);
    const fresh = tokenOf(
      (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ username: 'admin', password: TEST_PASSWORD })
          .expect(200)
      ).body,
    );
    await request(server)
      .get('/api/v1/test-protected')
      .auth(fresh, { type: 'bearer' })
      .expect(200);
    const failed = await request(server)
      .get('/api/v1/test-protected/failure')
      .auth(fresh, { type: 'bearer' })
      .expect(500);
    expect(failed.body).toMatchObject({
      error: { code: 'INTERNAL_ERROR', details: [] },
    });
    expect(failed.text).not.toContain('upstream-password-secret');
    expect(chunks.join('')).not.toContain('upstream-password-secret');
    expect(chunks.join('')).not.toContain('upstream-name-secret');
    expect(chunks.join('')).not.toContain('UPSTREAM_PRIVATE_TOKEN');
    expect(chunks.join('')).toContain('"errorName":"TypeError"');
    await app.close();
    const previousLength = chunks.length;
    app = await startApplication(
      environmentFor(directory.path, { ADMIN_PASSWORD: undefined }),
    );
    expect(chunks.slice(previousLength).join('')).not.toContain(
      'Initial administrator password',
    );
    expect(chunks.filter(bootstrapNotice)).toHaveLength(1);
    expect(chunks.filter(normalLog).join('')).not.toContain(password);
    expect(
      await readFile(join(directory.path, 'keys.json'), 'utf8'),
    ).not.toContain(password);
  });

  /** 用门闩固定 scrypt 竞争窗口，密码变化后旧校验不能签发有效会话。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('rejects login when the verified password snapshot changes during scrypt', async () => {
    app = await startApplication(environmentFor(directory.path));
    const entered = deferred();
    const release = deferred();
    const original = passwords.verifyPassword;
    vi.spyOn(passwords, 'verifyPassword').mockImplementation(
      /** 保留真实 crypto，只控制调用完成时序。
       * @param password 输入密码。
       * @param encoded 存储哈希。
       * @returns 校验结果。
       * @throws Error 底层 crypto 失败。
       */
      async (password, encoded) => {
        entered.resolve();
        await release.promise;
        return original(password, encoded);
      },
    );
    const login = app.get(AuthService).login('admin', TEST_PASSWORD, 'ip');
    const result = expect(login).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    try {
      await entered.promise;
      expect(
        app
          .get(DatabaseService)
          .changePassword(
            1,
            await passwords.hashPassword('new-password-for-race'),
          ),
      ).toBe(true);
    } finally {
      release.resolve();
    }
    await result;
  });
});

/** 识别唯一允许包含秘密的 bootstrap 输出。
 * @param value 输出行。
 * @returns 是否 bootstrap 行。
 * @throws 不适用。
 */
function bootstrapNotice(value: string): boolean {
  return value.startsWith('Initial administrator password');
}

/** 识别普通日志。
 * @param value 输出行。
 * @returns 是否普通日志。
 * @throws 不适用。
 */
function normalLog(value: string): boolean {
  return !bootstrapNotice(value);
}

/** 可控测试门闩，不需要修改项目的 ES2023 类型基线。 */
interface Deferred {
  /** 等待信号的 Promise。 */
  promise: Promise<void>;
  /** 释放等待者。 */
  resolve: () => void;
}

/** 创建显式控制的异步竞争窗口。
 * @param 不适用。
 * @returns 可等待、可释放的门闩。
 * @throws 不适用。
 */
function deferred(): Deferred {
  let resume: () => void;
  const promise = new Promise<void>(
    /** 保存 Promise 构造时同步提供的完成函数。
     * @param resolve 完成函数。
     * @returns 不适用。
     * @throws 不适用。
     */
    (resolve) => {
      resume = resolve;
    },
  );
  return {
    promise,
    /** 释放已经构造的 Promise。
     * @param 不适用。
     * @returns 不适用。
     * @throws 不适用。
     */
    resolve: () => resume(),
  };
}
