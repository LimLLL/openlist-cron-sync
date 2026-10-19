// 验证真实初始化失败窗口，fixture ENC 不代表 M1 生产端点已交付。
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { readFile, stat, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseService } from '../src/database/database.service.js';
import { KeysService } from '../src/security/keys.service.js';
import { Readiness } from '../src/coordination/coordination.module.js';
import { encrypt } from '../src/security/crypto.js';
import { writeKeyFile } from '../src/security/key-file.js';
import { initializeApplication } from '../src/http-setup.js';
import { AuthService } from '../src/security/auth.service.js';
import { errorTraits, StartupError } from '../src/common/errors.js';
import {
  constructApplication,
  environmentFor,
  startApplication,
  temporaryDirectory,
} from './helpers.js';
import { fixtureColumns } from './fixture-schema.js';
import type { TestDirectory } from './helpers.js';

/** 注册启动失败窗口。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M0 startup failure boundaries', () => {
  let directory: TestDirectory;

  /** 创建测试目录。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 文件系统失败。
   */
  beforeEach(async () => {
    directory = await temporaryDirectory();
  });

  /** 删除本测试拥有的数据。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    await directory.remove();
  });

  /** 普通环境校验发生于数据库打开前。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('fails invalid consumed environment before creating a database', async () => {
    await expect(
      constructApplication(
        environmentFor(directory.path, { PORT: 'invalid-secret' }),
      ),
    ).rejects.toThrow('Invalid configuration: PORT');
    await expect(
      stat(join(directory.path, 'app.sqlite')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  /** 数据库损坏时不会生成密钥或管理员。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('closes the failed database before any key/bootstrap step', async () => {
    await writeFile(join(directory.path, 'app.sqlite'), 'not a database');
    const app = await constructApplication(environmentFor(directory.path));
    const failure: unknown = await initializeApplication(app).then(
      () => undefined,
      /** 取得初始化异常以检查保留的根因。
       * @param error 初始化异常。
       * @returns 原异常。
       * @throws 不适用。
       */
      (error: unknown) => error,
    );
    if (!(failure instanceof StartupError))
      throw new Error('Expected StartupError');
    expect(failure.message).toBe('Database initialization or migration failed');
    // 根因只以异常名和错误码进入日志，便于运维区分损坏、权限或磁盘满。
    expect(errorTraits(failure.cause)).toEqual({
      errorName: 'SqliteError',
      causeCode: 'SQLITE_NOTADB',
    });
    expect(app.get(Readiness).ready).toBe(false);
    expect(() => app.get(DatabaseService).db).toThrow('not initialized');
    await expect(stat(join(directory.path, 'keys.json'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
  });

  /** 真实迁移 SQL 失败时不进入密钥阶段。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('fails a migration against an incompatible existing schema', async () => {
    const existing = new Database(join(directory.path, 'app.sqlite'));
    existing.exec('CREATE TABLE admins (unrelated TEXT)');
    existing.close();
    const app = await constructApplication(environmentFor(directory.path));
    await expect(initializeApplication(app)).rejects.toThrow(
      'Database initialization or migration failed',
    );
    await expect(stat(join(directory.path, 'keys.json'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
  });

  /** 冲突文件保持原样；迁移可以完成，但不能初始化管理员。
   * @param name 冲突的环境名。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it.each(['JWT_SECRET', 'ENCRYPTION_MASTER_KEY'])(
    'fails %s conflicts without changing stored keys',
    async (name) => {
      const stored = {
        version: 1 as const,
        jwtSecret: randomBytes(32).toString('base64'),
        encryptionMasterKey: randomBytes(32).toString('base64'),
      };
      const path = join(directory.path, 'keys.json');
      await writeKeyFile(path, stored);
      const before = await readFile(path, 'utf8');
      const app = await constructApplication(
        environmentFor(directory.path, {
          [name]: randomBytes(32).toString('base64'),
        }),
      );
      await expect(initializeApplication(app)).rejects.toMatchObject({
        code: 'CONFIG_KEY_CONFLICT',
      });
      expect(await readFile(path, 'utf8')).toBe(before);
      const database = new Database(join(directory.path, 'app.sqlite'));
      try {
        expect(
          database.prepare('SELECT count(*) AS count FROM admins').get(),
        ).toEqual({ count: 0 });
      } finally {
        database.close();
      }
    },
  );

  /** 真实 SQLite fixture 经完整生命周期验证，失败后加密服务不可用。
   * @param missing 是否缺少主密钥。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it.each([false, true])(
    'rejects fixture ciphertext with wrong/missing key (missing=%s)',
    async (missing) => {
      const key = randomBytes(32);
      const identity = {
        table: 'fixture_secrets',
        recordId: '1',
        field: 'secret_enc',
      };
      const value = encrypt(key, 'persisted-secret', identity);
      const connection = new Database(join(directory.path, 'app.sqlite'));
      connection.exec(
        'CREATE TABLE fixture_secrets (id INTEGER PRIMARY KEY, secret_enc TEXT)',
      );
      connection
        .prepare('INSERT INTO fixture_secrets VALUES (1, ?)')
        .run(value);
      connection.close();
      const app = await constructApplication(
        environmentFor(directory.path, {
          JWT_SECRET: randomBytes(32).toString('base64'),
          ENCRYPTION_MASTER_KEY: missing
            ? undefined
            : randomBytes(32).toString('base64'),
        }),
        fixtureColumns,
      );
      await expect(initializeApplication(app)).rejects.toMatchObject({
        code: 'KEY_MISMATCH',
      });
      expect(app.get(Readiness).ready).toBe(false);
      expect(() =>
        app.get(KeysService).encrypt('new-secret', identity),
      ).toThrow('Keys are not initialized');
      await expect(
        stat(join(directory.path, 'keys.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      const reopened = new Database(join(directory.path, 'app.sqlite'));
      try {
        expect(reopened.prepare('SELECT * FROM fixture_secrets').all()).toEqual(
          [{ id: 1, secret_enc: value }],
        );
        expect(
          reopened.prepare('SELECT count(*) AS count FROM admins').get(),
        ).toEqual({ count: 0 });
      } finally {
        reopened.close();
      }
      const valid = await startApplication(
        environmentFor(directory.path, {
          ENCRYPTION_MASTER_KEY: key.toString('base64'),
        }),
        fixtureColumns,
      );
      try {
        expect(valid.get(KeysService).decrypt(value, identity)).toBe(
          'persisted-secret',
        );
      } finally {
        await valid.close();
      }
    },
  );

  /** 环境密钥不复制进文件，目录链接可用且 spool 内容保留。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('uses environment-only keys and accepts linked data/spool directories', async () => {
    const data = join(directory.path, 'data');
    const spool = join(directory.path, 'spool');
    await mkdir(data);
    await mkdir(spool);
    await symlink(data, join(directory.path, 'data-link'));
    await symlink(spool, join(directory.path, 'spool-link'));
    await writeFile(join(spool, 'existing'), 'keep');
    const app = await startApplication(
      environmentFor(join(directory.path, 'data-link'), {
        SPOOL_DIR: join(directory.path, 'spool-link'),
        JWT_SECRET: randomBytes(32).toString('base64'),
        ENCRYPTION_MASTER_KEY: randomBytes(32).toString('base64'),
      }),
    );
    try {
      await expect(stat(join(data, 'keys.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await readFile(join(spool, 'existing'), 'utf8')).toBe('keep');
      expect((await stat(data)).mode & 0o777).toBe(0o700);
      expect((await stat(spool)).mode & 0o777).toBe(0o700);
    } finally {
      await app.close();
    }
  });

  /** 混合来源只持久化生成值；相等来源兼容，JWT 丢失后重新签名。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('preserves mixed key sources and regenerates only a missing JWT key', async () => {
    const master = randomBytes(32).toString('base64');
    const env = environmentFor(directory.path, {
      ENCRYPTION_MASTER_KEY: master,
    });
    const path = join(directory.path, 'keys.json');
    const first = await startApplication(env);
    let jwt: string;
    let token: string;
    try {
      jwt = first.get(KeysService).jwtSecret.toString('base64');
      token = (
        await first
          .get(AuthService)
          .login('admin', 'test-administrator-password', 'ip')
      ).accessToken;
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        version: 1,
        jwtSecret: jwt,
      });
    } finally {
      await first.close();
    }
    const equal = await startApplication({ ...env, JWT_SECRET: jwt });
    try {
      expect((await equal.get(AuthService).authenticate(token)).id).toBe(1);
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        version: 1,
        jwtSecret: jwt,
      });
    } finally {
      await equal.close();
    }
    await writeKeyFile(path, { version: 1 });
    const regenerated = await startApplication(env);
    try {
      expect(
        regenerated.get(KeysService).jwtSecret.toString('base64'),
      ).not.toBe(jwt);
      await expect(
        regenerated.get(AuthService).authenticate(token),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      const file = await readFile(path, 'utf8');
      expect(file).not.toContain(master);
    } finally {
      await regenerated.close();
    }
  });
});
