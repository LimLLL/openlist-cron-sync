// 读取和原子保存服务生成的密钥，禁止记录文件内容。
import { open, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { decodeBase64 } from '../configuration/validation.js';
import { errorTraits, StartupError } from '../common/errors.js';

/** v1 密钥文件；仅保存由服务生成的可选密钥。 */
export interface KeyFile {
  /** 固定版本。 */
  version: 1;
  /** JWT 密钥的标准 base64。 */
  jwtSecret?: string;
  /** 主密钥的标准 base64。 */
  encryptionMasterKey?: string;
}

/** 判断文件不存在错误。
 * @param error 原始异常。
 * @returns 是否 ENOENT。
 * @throws 不适用。
 */
function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** 读取密钥文件并在使用前收紧文件自身权限。
 * @param path keys.json 路径。
 * @returns 已验证文件；不存在时返回空 v1 文件。
 * @throws StartupError 文件格式、权限或读取失败。
 */
export async function readKeyFile(path: string): Promise<KeyFile> {
  let file: FileHandle;
  try {
    file = await open(path, 'r');
  } catch (error) {
    if (missing(error)) return { version: 1 };
    throw new StartupError('VALIDATION_ERROR', 'Cannot open keys file', error);
  }
  try {
    if (!(await file.stat()).isFile()) throw new Error('Not a file');
    if (((await file.stat()).mode & 0o7777) !== 0o600) await file.chmod(0o600);
    if (((await file.stat()).mode & 0o7777) !== 0o600)
      throw new Error('Unsafe mode');
    const parsed: unknown = JSON.parse(await file.readFile('utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('version' in parsed) ||
      parsed.version !== 1
    )
      throw new Error('Invalid keys file');
    const result: KeyFile = { version: 1 };
    for (const key of Object.keys(parsed)) {
      if (key === 'version') continue;
      if (key !== 'jwtSecret' && key !== 'encryptionMasterKey')
        throw new Error('Unknown keys field');
      const value: unknown = Reflect.get(parsed, key);
      if (typeof value !== 'string') throw new Error('Invalid key');
      decodeBase64(value, 32);
      result[key] = value;
    }
    return result;
  } catch (error) {
    throw new StartupError(
      'VALIDATION_ERROR',
      'Invalid or inaccessible keys file',
      error,
    );
  } finally {
    await file.close();
  }
}

/** 用私有临时文件原子替换密钥文件，并同步文件与目录。
 * @param path 目标文件路径。
 * @param keys 只含生成密钥的文件对象。
 * @returns 持久化完成的 Promise。
 * @throws StartupError 密钥未能可靠持久化。
 */
export async function writeKeyFile(path: string, keys: KeyFile): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.chmod(0o600);
      if (((await file.stat()).mode & 0o7777) !== 0o600) {
        throw new Error('Unsafe mode');
      }
      await file.writeFile(`${JSON.stringify(keys)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const directory = await open(dirname(path), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanup) {
      if (!missing(cleanup))
        new Logger('KeyFile').error('Cannot remove temporary keys file', {
          errorCode: 'INTERNAL_ERROR',
          ...errorTraits(cleanup),
        });
    }
    throw new StartupError(
      'INTERNAL_ERROR',
      'Cannot persist generated keys',
      error,
    );
  }
}
