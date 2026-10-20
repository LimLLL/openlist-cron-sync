// 验证严格环境解析和非递归目录权限规则。
import { ConfigService } from '@nestjs/config';
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { AppConfig } from '../src/configuration/app-config.js';
import { privateDirectory } from '../src/configuration/directories.js';
import { environmentFor, temporaryDirectory } from './helpers.js';

/** 注册配置用例。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M0 configuration', () => {
  /** 错误仅指出字段，不输出输入值。
   * @param field 字段名。
   * @param value 非法输入。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it.each([
    ['PORT', ''],
    ['PORT', '1.5'],
    ['PORT', '-1'],
    ['PORT', '65536'],
    ['PORT', '1e3'],
    ['API_DOCS_ENABLED', 'yes'],
    ['API_DOCS_ENABLED', ''],
    ['DATA_DIR', 'relative'],
    ['HOST', 'http://bad'],
    ['HOST', ''],
    ['LOG_LEVEL', 'trace'],
    ['NODE_ENV', 'bad'],
    ['TRUST_PROXY_HOPS', '6'],
    ['JWT_SECRET', 'not-a-secret'],
    ['ENCRYPTION_MASTER_KEY', ''],
  ])('rejects %s=%s without revealing its value', (field, value) => {
    expect(
      () =>
        new AppConfig(
          new ConfigService({
            environment: environmentFor('/tmp/m0', { [field]: value }),
          }),
        ),
    ).toThrow(`Invalid configuration: ${field}`);
  });

  /** bootstrap 字段不进入常规配置验证。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('defers bootstrap validation and leaves unused settings alone', () => {
    const config = new AppConfig(
      new ConfigService({
        environment: environmentFor('/tmp/m0', {
          ADMIN_PASSWORD: '',
        }),
      }),
    );
    expect(config.port).toBe(3000);
    expect(() => config.bootstrapCredentials()).toThrow('ADMIN_PASSWORD');
  });

  /** 解析符号链接，只修改目标目录自身，保留 spool 内容。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言失败。
   */
  it('accepts symlink directories and tightens only the directory itself', async () => {
    const temporary = await temporaryDirectory();
    try {
      const target = join(temporary.path, 'actual');
      await mkdir(target);
      await chmod(target, 0o755);
      const child = join(target, 'existing-block');
      await writeFile(child, 'keep', { mode: 0o644 });
      await chmod(child, 0o644);
      const alias = join(temporary.path, 'alias');
      await symlink(target, alias);
      expect(await privateDirectory(alias, 'SPOOL_DIR')).toBe(
        await realpath(target),
      );
      expect((await stat(target)).mode & 0o777).toBe(0o700);
      expect((await stat(child)).mode & 0o777).toBe(0o644);
      expect(await readFile(child, 'utf8')).toBe('keep');
      await expect(privateDirectory(child, 'DATA_DIR')).rejects.toThrow(
        'DATA_DIR',
      );
    } finally {
      await temporary.remove();
    }
  });
});
