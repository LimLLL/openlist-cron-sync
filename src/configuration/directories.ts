// 准备私有目录，接受目录符号链接且不递归修改已有内容。
import { chmod, mkdir, realpath, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { StartupError } from '../common/errors.js';

/** 创建或收紧一个应用目录并检查可访问性。
 * @param path 配置路径，允许符号链接。
 * @param field 配置字段名，用于安全诊断。
 * @returns 解析后的真实目录。
 * @throws StartupError 目录或权限无法建立。
 */
export async function privateDirectory(
  path: string,
  field: string,
): Promise<string> {
  try {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const resolved = await realpath(path);
    const info = await stat(resolved);
    if (!info.isDirectory()) throw new Error('Not a directory');
    if ((info.mode & 0o7777) !== 0o700) await chmod(resolved, 0o700);
    if (((await stat(resolved)).mode & 0o7777) !== 0o700)
      throw new Error('Unsafe mode');
    await access(resolved, constants.R_OK | constants.W_OK | constants.X_OK);
    return resolved;
  } catch (error) {
    throw new StartupError(
      'VALIDATION_ERROR',
      `Cannot prepare private directory: ${field}`,
      error,
    );
  }
}
