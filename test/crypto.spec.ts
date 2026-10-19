// 用真实 SQLite 与真实密码学验证 ENC 扫描、密钥来源和密码封装。
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { randomBytes } from 'node:crypto';
import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encrypt, decrypt, verifyCiphertexts } from '../src/security/crypto.js';
import { readEncryptedValues } from '../src/database/encrypted-columns.js';
import { readKeyFile, writeKeyFile } from '../src/security/key-file.js';
import {
  hashPassword,
  parsePasswordHash,
  verifyPassword,
} from '../src/security/passwords.js';
import { temporaryDirectory, TEST_PASSWORD } from './helpers.js';
import { fixtureSecrets, fixtureColumns } from './fixture-schema.js';

/** 注册加密组件测试。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M0 crypto', () => {
  /** 验证 AAD、随机 nonce、篡改检测及严格封装解析。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('binds ciphertext to its record and authenticates every byte', () => {
    const key = randomBytes(32);
    const identity = {
      table: 'fixture_secrets',
      recordId: '1',
      field: 'secret_enc',
    };
    const value = encrypt(key, 'secret', identity);
    expect(encrypt(key, 'secret', identity)).not.toEqual(value);
    expect(decrypt(key, value, identity)).toBe('secret');
    expect(decrypt(key, encrypt(key, '', identity), identity)).toBe('');
    expect(() => decrypt(randomBytes(32), value, identity)).toThrow(
      'Cannot decrypt',
    );
    expect(() => decrypt(key, value, { ...identity, recordId: '2' })).toThrow(
      'Cannot decrypt',
    );
    expect(() => decrypt(key, value, { ...identity, field: 'other' })).toThrow(
      'Cannot decrypt',
    );
    const envelope: Record<string, unknown> = JSON.parse(value);
    for (const bad of [
      '',
      '{}',
      JSON.stringify({ ...envelope, v: 2 }),
      JSON.stringify({ ...envelope, tag: randomBytes(16).toString('base64') }),
      JSON.stringify({ ...envelope, nonce: 'invalid' }),
    ]) {
      expect(() => decrypt(key, bad, identity)).toThrow('Cannot decrypt');
    }
  });

  /** 跨批次遍历真实 SQLite，空清单为空且错误密文不修改数据库。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('walks every persisted ENC row in bounded batches using a supplied inventory', async () => {
    const temporary = await temporaryDirectory();
    const connection = new Database(join(temporary.path, 'fixture.sqlite'));
    try {
      connection.exec(
        'CREATE TABLE fixture_secrets (id INTEGER PRIMARY KEY, secret_enc TEXT)',
      );
      const db = drizzle(connection);
      const key = randomBytes(32);
      for (let id = 1; id <= 205; id++)
        db.insert(fixtureSecrets)
          .values({
            id,
            secret: encrypt(key, `value-${id}`, {
              table: 'fixture_secrets',
              recordId: String(id),
              field: 'secret_enc',
            }),
          })
          .run();
      db.insert(fixtureSecrets).values({ id: 206, secret: null }).run();
      expect([...readEncryptedValues(db, [])]).toEqual([]);
      expect([...readEncryptedValues(db, fixtureColumns)]).toHaveLength(205);
      verifyCiphertexts(key, readEncryptedValues(db, fixtureColumns));
      const before = db.select().from(fixtureSecrets).all();
      expect(() =>
        verifyCiphertexts(
          randomBytes(32),
          readEncryptedValues(db, fixtureColumns),
        ),
      ).toThrow('Cannot decrypt');
      expect(db.select().from(fixtureSecrets).all()).toEqual(before);
      connection
        .prepare('UPDATE fixture_secrets SET secret_enc = ? WHERE id = 205')
        .run('');
      expect(() =>
        verifyCiphertexts(key, readEncryptedValues(db, fixtureColumns)),
      ).toThrow('Cannot decrypt');
    } finally {
      connection.close();
      await temporary.remove();
    }
  });

  /** 验证私有文件、保留字段和严格输入。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('atomically saves generated keys and tightens an existing keys file', async () => {
    const temporary = await temporaryDirectory();
    try {
      const path = join(temporary.path, 'keys.json');
      expect(await readKeyFile(path)).toEqual({ version: 1 });
      const jwtSecret = randomBytes(32).toString('base64');
      await writeKeyFile(path, { version: 1, jwtSecret });
      await chmod(path, 0o644);
      const initial = await readKeyFile(path);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      await writeKeyFile(path, {
        ...initial,
        encryptionMasterKey: randomBytes(32).toString('base64'),
      });
      expect(await readKeyFile(path)).toMatchObject({ jwtSecret });
      await writeFile(path, '{"version":1,"jwtSecret":"bad-secret"}');
      await expect(readKeyFile(path)).rejects.toThrow(
        'Invalid or inaccessible keys file',
      );
      expect(await readFile(path, 'utf8')).toContain('bad-secret');
    } finally {
      await temporary.remove();
    }
  });

  /** 验证真实 scrypt 与数据库参数封装上限。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('uses real scrypt and refuses unsupported resource parameters', async () => {
    const hash = await hashPassword(TEST_PASSWORD);
    expect(hash).toMatch(/^scrypt\$v1\$131072\$8\$1\$/);
    expect(await verifyPassword(TEST_PASSWORD, hash)).toBe(true);
    expect(await verifyPassword('wrong-password-value', hash)).toBe(false);
    expect(() =>
      parsePasswordHash(hash.replace('131072', '1073741824')),
    ).toThrow('Invalid administrator password hash');
  });
});
