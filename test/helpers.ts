// 提供真实 Nest/SQLite 测试夹具，所有应用走生产初始化路径。
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createAppModule } from '../src/app.module.js';
import {
  applicationOptions,
  initializeApplication,
} from '../src/http-setup.js';
import type { Environment } from '../src/configuration/validation.js';
import { ENCRYPTED_COLUMNS } from '../src/database/encrypted-columns.js';
import type { EncryptedColumn } from '../src/database/encrypted-columns.js';

export const TEST_PASSWORD = 'test-administrator-password';

/** 测试目录资源。 */
export interface TestDirectory {
  /** 系统临时目录下的独立路径。 */
  path: string;
  /** 仅删除测试拥有的目录。 */
  remove: () => Promise<void>;
}

/** 创建隔离测试目录。
 * @param 不适用。
 * @returns 目录资源。
 * @throws Error 文件系统操作失败。
 */
export async function temporaryDirectory(): Promise<TestDirectory> {
  const path = await mkdtemp(join(tmpdir(), 'openlist-m0-'));
  return {
    path,
    /** 清理此测试创建的目录。
     * @param 不适用。
     * @returns 删除完成的 Promise。
     * @throws Error 删除失败。
     */
    remove: () => rm(path, { recursive: true, force: true }),
  };
}

/** 生成不读取真实 shell 的测试环境。
 * @param directory 测试数据目录。
 * @param overrides 本场景的环境差异。
 * @returns 测试环境。
 * @throws 不适用。
 */
export function environmentFor(
  directory: string,
  overrides: Environment = {},
): Environment {
  return {
    NODE_ENV: 'test',
    DATA_DIR: directory,
    HOST: '127.0.0.1',
    LOG_LEVEL: 'error',
    ADMIN_PASSWORD: TEST_PASSWORD,
    ...overrides,
  };
}

/** 构造真实 Nest 应用，普通 fixture 输入可替换 ENC 清单。
 * @param environment 本实例环境。
 * @param columns 可选的真实 SQLite fixture 列。
 * @returns 尚未初始化的应用。
 * @throws Error Nest DI 配置错误。
 */
export async function constructApplication(
  environment: Environment,
  columns?: readonly EncryptedColumn[],
): Promise<NestExpressApplication> {
  const builder = Test.createTestingModule({
    imports: [await createAppModule(environment)],
  });
  if (columns !== undefined)
    builder.overrideProvider(ENCRYPTED_COLUMNS).useValue(columns);
  const module = await builder.compile();
  return module.createNestApplication<NestExpressApplication>(
    applicationOptions(),
  );
}

/** 完整初始化并在临时端口监听。
 * @param environment 本实例环境。
 * @param columns 可选 fixture 清单。
 * @returns 已监听应用。
 * @throws Error 初始化或监听失败。
 */
export async function startApplication(
  environment: Environment,
  columns?: readonly EncryptedColumn[],
): Promise<NestExpressApplication> {
  const app = await constructApplication(environment, columns);
  await initializeApplication(app);
  try {
    await app.listen(0, '127.0.0.1');
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}

/** 从未知 HTTP 响应读取 token。
 * @param body 响应体。
 * @returns token。
 * @throws Error 响应格式错误。
 */
export function tokenOf(body: unknown): string {
  if (
    !body ||
    typeof body !== 'object' ||
    !('accessToken' in body) ||
    typeof body.accessToken !== 'string'
  )
    throw new Error('Missing token');
  return body.accessToken;
}
