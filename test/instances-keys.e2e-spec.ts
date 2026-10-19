// 证明首个生产 ENC 字段阻止错密钥或缺密钥启动，且不写入新密文。
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import request from 'supertest';
import {
  constructApplication,
  environmentFor,
  startApplication,
  temporaryDirectory,
  TEST_PASSWORD,
  tokenOf,
} from './helpers.js';
import { initializeApplication } from '../src/http-setup.js';
import { KeysService } from '../src/security/keys.service.js';

describe('M1 production ENC startup acceptance', /** 注册本组 M1 行为验收用例。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
() => {
  it.each(['missing', 'wrong'])(
    'fails KEY_MISMATCH for %s master key without new ENC writes',

    /** 验证当前场景的协议输入、输出与副作用。
     * @param mode 本次认证或故障模式。
     * @returns 断言完成；异步用例返回完成 Promise。
     * @throws Error 断言或测试资源操作失败。
     */
    async (mode) => {
      const directory = await temporaryDirectory();
      const master = randomBytes(32).toString('base64');
      const env = environmentFor(directory.path, {
        ENCRYPTION_MASTER_KEY: master,
      });
      const app = await startApplication(env);
      try {
        const base = await app.getUrl();
        const login = await request(base)
          .post('/api/v1/auth/login')
          .send({ username: 'admin', password: TEST_PASSWORD })
          .expect(200);
        await request(base)
          .post('/api/v1/instances')
          .auth(tokenOf(login.body), { type: 'bearer' })
          .send({
            name: 'ENC production',
            baseUrl: 'http://127.0.0.1:9999',
            auth: { mode: 'token', secret: 'production-instance-secret' },
          })
          .expect(201);
      } finally {
        await app.close();
      }
      try {
        const database = new Database(join(directory.path, 'app.sqlite'));
        const before: unknown[] = database
          .prepare('SELECT id, secret_enc FROM instances')
          .all();
        database.close();
        const keyFile = await readFile(
          join(directory.path, 'keys.json'),
          'utf8',
        );
        expect(keyFile).not.toContain(master);
        const broken = await constructApplication(
          environmentFor(directory.path, {
            ENCRYPTION_MASTER_KEY:
              mode === 'missing'
                ? undefined
                : randomBytes(32).toString('base64'),
          }),
        );
        await expect(initializeApplication(broken)).rejects.toMatchObject({
          code: 'KEY_MISMATCH',
        });
        expect(
          /** 验证当前场景的协议输入、输出与副作用。
           * @param 不适用。
           * @returns 断言完成；异步用例返回完成 Promise。
           * @throws Error 断言或测试资源操作失败。
           */
          () =>
            broken.get(KeysService).encrypt('must-not-write', {
              table: 'instances',
              recordId: 'new',
              field: 'secret_enc',
            }),
        ).toThrow('Keys are not initialized');
        const after = new Database(join(directory.path, 'app.sqlite'));
        try {
          expect(
            after.prepare('SELECT id, secret_enc FROM instances').all(),
          ).toEqual(before);
        } finally {
          after.close();
        }
        expect(await readFile(join(directory.path, 'keys.json'), 'utf8')).toBe(
          keyFile,
        );
      } finally {
        await directory.remove();
      }
    },
  );
});
