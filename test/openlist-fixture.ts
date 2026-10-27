// 提供 F1 进程内 HTTP 故障服务与真实 Nest/SQLite 组件夹具。
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  startApplication,
  temporaryDirectory,
  environmentFor,
} from './helpers.js';
import type { TestDirectory } from './helpers.js';
import { InstancesService } from '../src/instances/instances.service.js';
import { OpenListClient } from '../src/openlist/client.service.js';
import type { InstanceRecord } from '../src/database/schema.js';
import type { Environment } from '../src/configuration/validation.js';

/** F1 捕获的测试请求；只在测试内存中使用，不写日志。 */
export interface CapturedCall {
  /** 不含代理前缀的路径及查询。 */
  url: string;
  /** 原始方法。 */
  method: string;
  /** 请求头。 */
  headers: IncomingMessage['headers'];
  /** 原始字节。 */
  bytes: Buffer;
  /** 仅 JSON 请求解析为 unknown。 */
  json: unknown;
}
/** 可控上游响应。 */
export interface Reply {
  /** HTTP 状态，默认 200。 */
  status?: number;
  /** 原始或 envelope 响应。 */
  body?: unknown;
  /** 响应头。 */
  headers?: Record<string, string>;
  /** 断开连接而不响应。 */
  disconnect?: boolean;
  /** 可控分段响应，用于真实网络断流；拥有结束response的责任。 */
  stream?: (response: ServerResponse) => Promise<void>;
}
/** 可替换的异步故障处理器。 */
export type Responder = (
  call: CapturedCall,
) => Reply | undefined | Promise<Reply | undefined>;
/** 可控完成门闩，不依赖 sleep 制造竞态。 */
export interface Latch {
  /** 等待释放。 */
  promise: Promise<void>;
  /** 释放一次。 */
  release: () => void;
}
/** 创建可控门闩。
 * @param 不适用。
 * @returns 等待与释放函数。
 * @throws 不适用。
 */
export function latch(): Latch {
  let release: (() => void) | undefined;
  const promise = new Promise<void>(
    /** 保存测试门闩的释放函数。
     * @param resolve 门闩完成回调。
     * @returns 不适用。
     * @throws 不适用。
     */
    (resolve) => {
      release = resolve;
    },
  );
  if (!release) throw new Error('Missing latch resolver');
  return { promise, release };
}
/** 成功或失败的 OpenList envelope。
 * @param data 数据。
 * @param code 应用码。
 * @returns F1 响应。
 * @throws 不适用。
 */
export function envelope(data: unknown, code = 200): Reply {
  return { body: { code, message: 'fixture message', data } };
}
/** 默认可用文件。
 * @param name 名称。
 * @returns 上游文件 JSON。
 * @throws 不适用。
 */
export function file(name = 'file.txt'): Record<string, unknown> {
  return {
    name,
    size: 12,
    is_dir: false,
    modified: '2026-10-19T00:00:00Z',
    sign: 'private-sign',
    raw_url: 'https://secret.invalid/private?key=secret',
  };
}
/** 默认可用存储，addition 是专用泄漏检测标记。
 * @param id ID。
 * @param mountPath 挂载路径。
 * @returns 存储 JSON。
 * @throws 不适用。
 */
export function storage(id = 1, mountPath = '/'): Record<string, unknown> {
  return {
    id,
    mount_path: mountPath,
    driver: 'Local',
    disabled: false,
    status: 'work',
    addition: 'STORAGE_ADDITION_MUST_NOT_LEAK',
  };
}
/** F1 HTTP 服务。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class F1Server {
  readonly calls: CapturedCall[] = [];
  responder?: Responder;
  baseUrl = '';
  private readonly server = createServer(this.handle.bind(this));
  /** 在临时端口监听并保留反代子路径。
   * @param 不适用。
   * @returns 服务实例。
   * @throws Error socket 失败。
   */
  async start(): Promise<this> {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing F1 address');
    this.baseUrl = `http://127.0.0.1:${address.port}/proxy`;
    return this;
  }
  /** 停止本测试服务。
   * @param 不适用。
   * @returns 关闭完成。
   * @throws Error 关闭失败。
   */
  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>(
      /** 等待服务器关闭。
       * @param resolve 成功回调。
       * @param reject 失败回调。
       * @returns 不适用。
       * @throws 不适用。
       */
      (resolve, reject) =>
        this.server.close(
          /** 转换关闭结果。
           * @param error socket 错误。
           * @returns 不适用。
           * @throws 不适用。
           */
          (error) => (error ? reject(error) : resolve()),
        ),
    );
  }
  /** HTTP 回调显式处理异步异常，避免悬空 Promise。
   * @param request 请求。
   * @param response 响应。
   * @returns 不适用。
   * @throws 不适用。
   */
  private handle(request: IncomingMessage, response: ServerResponse): void {
    this.respond(request, response).catch(
      /** 把测试服务器异常转为明确失败响应。
       * @param error 异常。
       * @returns 不适用。
       * @throws 不适用。
       */
      (error: unknown) => {
        response.statusCode = 500;
        response.end(String(error));
      },
    );
  }
  /** 读取请求并执行可控处理器。
   * @param request 请求。
   * @param response 响应。
   * @returns 响应完成。
   * @throws Error 读取或测试处理器失败。
   */
  private async respond(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const part of request) {
      if (!Buffer.isBuffer(part)) throw new Error('Invalid request chunk');
      chunks.push(part);
    }
    const bytes = Buffer.concat(chunks);
    const url = request.url ?? '';
    if (!url.startsWith('/proxy/')) {
      response.writeHead(404);
      response.end();
      return;
    }
    const call: CapturedCall = {
      url: url.slice('/proxy'.length),
      method: request.method ?? '',
      headers: request.headers,
      bytes,
      json:
        request.headers['content-type'] === 'application/json'
          ? (JSON.parse(bytes.toString()) as unknown)
          : undefined,
    };
    this.calls.push(call);
    const reply = (await this.responder?.(call)) ?? defaultReply(call);
    if (reply.disconnect) {
      response.destroy();
      return;
    }
    response.writeHead(reply.status ?? 200, {
      'content-type': 'application/json',
      ...reply.headers,
    });
    if (reply.stream) {
      await reply.stream(response);
      return;
    }
    response.end(
      Buffer.isBuffer(reply.body) || typeof reply.body === 'string'
        ? reply.body
        : JSON.stringify(reply.body ?? { code: 200, message: '', data: null }),
    );
  }
}
/** 普通成功路径，不实现与测试无关的上游功能。
 * @param call 捕获请求。
 * @returns 默认响应。
 * @throws 不适用。
 */
function defaultReply(call: CapturedCall): Reply {
  if (call.url === '/api/auth/login/hash')
    return envelope({ token: 'jwt-in-memory' });
  if (call.url === '/api/me')
    return envelope({
      username: 'admin',
      base_path: '/',
      role: 2,
      permission: 255,
    });
  if (call.url === '/api/public/settings')
    return envelope({
      version: 'v4.2.6 (Commit: fixture)',
      multipart_enabled: 'true',
      multipart_chunk_size: '8',
    });
  if (call.url === '/api/fs/list')
    return envelope({ content: [file()], total: 1, write: true });
  if (call.url.startsWith('/api/admin/storage/list'))
    return envelope({ content: [storage()], total: 1 });
  return envelope(null);
}
/** 组件测试拥有的真实资源。 */
export interface ComponentFixture {
  /** 临时数据库目录。 */
  directory: TestDirectory;
  /** F1 服务器。 */
  server: F1Server;
  /** 当前 Nest 应用。 */
  app: NestExpressApplication;
  /** 读取当前内部实例。 */
  record: () => InstanceRecord;
  /** 真实客户端。 */
  client: OpenListClient;
  /** 稳定实例 UUID。 */
  id: string;
  /** 用同一数据库重启应用。 */
  restart: () => Promise<void>;
  /** 清理全部测试资源。 */
  close: () => Promise<void>;
}
/** 创建生产配置/数据库路径的组件测试环境。
 * @param mode 认证模式。
 * @param overrides 环境差异。
 * @returns F1 与完整 Nest 应用。
 * @throws Error 初始化失败。
 */
export async function componentFixture(
  mode: 'token' | 'password' = 'password',
  overrides: Environment = {},
): Promise<ComponentFixture> {
  const directory = await temporaryDirectory();
  const server = await new F1Server().start();
  const environment = environmentFor(directory.path, {
    RETRY_BASE_MS: '100',
    RETRY_MAX_MS: '100',
    RETRY_MAX_ATTEMPTS: '2',
    ...overrides,
  });
  const app = await startApplication(environment);
  const service = app.get(InstancesService);
  const view = service.create({
    name: 'Fixture',
    baseUrl: server.baseUrl,
    auth:
      mode === 'token'
        ? { mode, secret: 'static-token' }
        : { mode, username: 'admin', secret: 'openlist-password' },
  });
  const fixture: ComponentFixture = {
    directory,
    server,
    app,
    id: view.id,
    client: app.get(OpenListClient),
    /** 读取最新配置。
     * @param 不适用。
     * @returns 实例记录。
     * @throws Error 数据库失败。
     */
    record: () => fixture.app.get(InstancesService).record(view.id),
    /** 重启但保留 SQLite。
     * @param 不适用。
     * @returns 重启完成。
     * @throws Error 初始化失败。
     */
    restart: async () => {
      await fixture.app.close();
      fixture.app = await startApplication(environment);
      fixture.client = fixture.app.get(OpenListClient);
    },
    /** 关闭本测试拥有的全部资源。
     * @param 不适用。
     * @returns 清理完成。
     * @throws Error 清理失败。
     */
    close: async () => {
      await fixture.app.close();
      await server.close();
      await directory.remove();
    },
  };
  return fixture;
}
