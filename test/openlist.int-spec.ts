// 对维护者准备的真实 OpenList Local 存储执行只读 M1 验收。
import type { NestExpressApplication } from '@nestjs/platform-express';
import { integrationEnvironment } from './integration-environment.js';
import {
  startApplication,
  environmentFor,
  temporaryDirectory,
} from './helpers.js';
import type { TestDirectory } from './helpers.js';
import { InstancesService } from '../src/instances/instances.service.js';
import { InstanceOperations } from '../src/instances/instance-operations.service.js';
import { OpenListClient } from '../src/openlist/client.service.js';
import { globalPath } from '../src/openlist/paths.js';
import { resolveMount } from '../src/openlist/mounts.js';

const environment = integrationEnvironment();

describe('M1 real OpenList with Local storage', /** 注册本组 M1 行为验收用例。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
() => {
  let app: NestExpressApplication;
  let directory: TestDirectory;
  let tokenId: string;
  let passwordId: string;
  beforeAll(
    /** 创建隔离应用并准备本组测试身份。
     * @param 不适用。
     * @returns 初始化完成的 Promise。
     * @throws Error 测试初始化失败。
     */
    async () => {
      directory = await temporaryDirectory();
      app = await startApplication(environmentFor(directory.path));
      const instances = app.get(InstancesService);
      tokenId = instances.create({
        name: 'Real token',
        baseUrl: environment.baseUrl,
        auth: { mode: 'token', secret: environment.adminToken },
      }).id;
      passwordId = instances.create({
        name: 'Real password',
        baseUrl: environment.baseUrl,
        auth: {
          mode: 'password',
          username: environment.username,
          secret: environment.password,
        },
      }).id;
    },
  );
  afterAll(
    /** 恢复测试状态并释放本用例拥有的资源。
     * @param 不适用。
     * @returns 清理完成；异步资源返回 Promise。
     * @throws Error 资源清理失败。
     */
    async () => {
      if (app) await app.close();
      if (directory) await directory.remove();
    },
  );
  it('connects with both bare token and password hash and reads supported settings', /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */
  async () => {
    for (const id of [tokenId, passwordId]) {
      const result = await app
        .get(InstanceOperations)
        .test(id, { retryAuth: false });
      expect(result).toMatchObject({
        reachable: true,
        authenticated: true,
        error: null,
      });
      expect(result.account?.role).not.toBe(1);
      const view = app.get(InstancesService).get(id);
      expect(view.authState).toBe('ready');
      expect(view.openlistVersion).toMatch(/\d+\.\d+\.\d+/);
      expect(view.multipartEnabled).toBeTypeOf('boolean');
    }
  });
  it('browses Local through both authentication modes without returning download secrets', /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */
  async () => {
    for (const id of [tokenId, passwordId]) {
      const result = await app.get(InstanceOperations).browse(id, {
        path: environment.localPath,
        refresh: false,
        page: 1,
        pageSize: 50,
      });
      expect(result.total).toBeGreaterThanOrEqual(result.items.length);
      expect(result.path).toBe(environment.localPath.replace(/\/$/, '') || '/');
      for (const item of result.items)
        expect(Object.keys(item).sort()).toEqual([
          'isDir',
          'modified',
          'name',
          'size',
        ]);
    }
  });
  it('resolves the complete admin mount map to a unique live Local storage', /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */
  async () => {
    const instance = app.get(InstancesService).record(tokenId);
    const client = app.get(OpenListClient);
    const account = await client.auth.account(instance);
    expect(account.role).toBe(2);
    const storages = await client.storages(instance);
    const mount = resolveMount(
      storages,
      globalPath(account.basePath, environment.localPath),
    );
    expect(mount.storage).not.toBeNull();
    expect(mount.storage?.driver).toBe('Local');
    for (const storage of storages)
      expect(Object.keys(storage).sort()).toEqual([
        'disabled',
        'driver',
        'effectiveMount',
        'id',
        'mountPath',
        'status',
      ]);
  });
});
