// 使用固定参数的异步 scrypt 存储和比较管理员密码。
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { decodeBase64 } from '../configuration/validation.js';
import { StartupError } from '../common/errors.js';

/** 已解析的哈希，只允许本服务支持的固定参数。 */
interface PasswordHash {
  /** 16 字节随机盐。 */
  salt: Buffer;
  /** 32 字节派生密钥。 */
  key: Buffer;
}

/** 严格读取受支持的哈希，不接受数据库提供的任意资源参数。
 * @param encoded 存储哈希。
 * @returns 盐与派生密钥。
 * @throws StartupError 存储格式或参数不受支持。
 */
export function parsePasswordHash(encoded: string): PasswordHash {
  try {
    const parts = encoded.split('$');
    if (
      parts.length !== 7 ||
      parts.slice(0, 5).join('$') !== 'scrypt$v1$131072$8$1'
    )
      throw new Error('Unsupported hash');
    return {
      salt: decodeBase64(parts[5], 16),
      key: decodeBase64(parts[6], 32),
    };
  } catch {
    throw new StartupError(
      'INTERNAL_ERROR',
      'Invalid administrator password hash',
    );
  }
}

/** 异步派生密钥；调用者负责执行认证并发限制。
 * @param password 原始密码。
 * @param salt 随机盐。
 * @returns 32 字节派生密钥。
 * @throws Error 底层 scrypt 失败。
 */
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise(
    /** 启动一次异步 scrypt。
     * @param resolve 成功回调。
     * @param reject 失败回调。
     * @returns 不适用。
     * @throws 不适用；异常由 Promise 接收。
     */
    (resolve, reject) => {
      scrypt(
        password,
        salt,
        32,
        { N: 131072, r: 8, p: 1, maxmem: 201326592 },
        /** 返回派生结果。
         * @param error scrypt 错误。
         * @param key 派生密钥。
         * @returns 不适用。
         * @throws 不适用。
         */
        (error, key) => {
          if (error) reject(error);
          else resolve(key);
        },
      );
    },
  );
}

/** 生成含随机盐的 v1 密码哈希。
 * @param password 有效密码。
 * @returns 编码哈希。
 * @throws Error scrypt 失败。
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$v1$131072$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** 用常量时间比较派生密钥。
 * @param password 输入密码。
 * @param encoded 存储哈希。
 * @returns 是否匹配。
 * @throws Error 哈希格式或 scrypt 失败。
 */
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  return timingSafeEqual(await derive(password, parsed.salt), parsed.key);
}
