// 通过真实 Vite 配置加载验证端口来源；使用独立目录，不修改开发者的 .env。
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { resolveConfig } from 'vite';

/** 验证仓库根目录配置和显式代理覆盖值的优先级。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('development API proxy', () => {
  let directory: string;
  let webDirectory: string;

  /** 创建最小 workspace 夹具并复用已安装依赖，保持真实配置加载路径。
   * @returns 夹具准备完成。
   * @throws Error 文件系统操作失败。
   */
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'openlist-vite-'));
    webDirectory = join(directory, 'web');
    await mkdir(webDirectory);
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await copyFile(
      new URL('./vite.config.ts', import.meta.url),
      join(webDirectory, 'vite.config.ts'),
    );
    await symlink(
      fileURLToPath(new URL('./node_modules', import.meta.url)),
      join(webDirectory, 'node_modules'),
      'junction',
    );
  });

  /** 恢复测试修改的进程环境变量。
   * @returns 不适用。
   * @throws 不适用。
   */
  afterEach(() => vi.unstubAllEnvs());

  /** 只清理本测试创建的目录，保留真实 workspace 和依赖。
   * @returns 清理完成。
   * @throws Error 目录清理失败。
   */
  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  /** 后端的开发模式不能使正式前端产物打包 React 开发版本。
   * @returns 断言完成。
   * @throws Error 配置加载或断言失败。
   */
  it('keeps the backend NODE_ENV out of production builds', async () => {
    vi.stubEnv('NODE_ENV', undefined);
    vi.stubEnv('VITE_USER_NODE_ENV', undefined);
    await writeFile(
      join(directory, '.env'),
      'NODE_ENV=development\nPORT=39123',
    );
    const config = await resolveConfig(
      {
        root: webDirectory,
        configFile: join(webDirectory, 'vite.config.ts'),
        logLevel: 'silent',
      },
      'build',
      'production',
      'production',
    );
    expect(config.isProduction).toBe(true);
  });

  it.each([
    {
      name: 'uses PORT from the repository root',
      file: 'PORT=39123',
      port: undefined,
      override: undefined,
      expected: '39123',
    },
    {
      name: 'supports VITE_API_PORT in the root env file',
      file: 'PORT=39123\nVITE_API_PORT=40123',
      port: undefined,
      override: undefined,
      expected: '40123',
    },
    {
      name: 'prefers an exported VITE_API_PORT',
      file: 'PORT=39123\nVITE_API_PORT=40123',
      port: undefined,
      override: '41123',
      expected: '41123',
    },
    {
      name: 'honours an exported backend PORT',
      file: 'PORT=39123',
      port: '42123',
      override: undefined,
      expected: '42123',
    },
    {
      name: 'defaults to 3000 without a configured port',
      file: '',
      port: undefined,
      override: undefined,
      expected: '3000',
    },
  ])(
    '$name',
    /** 从临时 workspace 加载真实 Vite 配置并检查代理及浏览器环境隔离。
     * @param scenario 文件配置、进程覆盖值与预期端口。
     * @returns 断言完成。
     * @throws Error 配置加载或断言失败。
     */
    async ({ file, port, override, expected }) => {
      vi.stubEnv('PORT', port);
      vi.stubEnv('VITE_API_PORT', override);
      await writeFile(
        join(directory, '.env'),
        `${file}\nADMIN_PASSWORD=fixture-secret\nVITE_BACKEND_ONLY=fixture-only`,
      );
      const config = await resolveConfig(
        {
          root: webDirectory,
          configFile: join(webDirectory, 'vite.config.ts'),
          logLevel: 'silent',
        },
        'serve',
      );
      expect(config.server.proxy?.['/api/v1']).toBe(
        `http://localhost:${expected}`,
      );
      expect(config.env).not.toHaveProperty('ADMIN_PASSWORD');
      expect(config.env).not.toHaveProperty('VITE_BACKEND_ONLY');
    },
  );
});
