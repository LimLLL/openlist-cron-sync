// 模拟实际文件和multipart副作用的F1，所有数据仅存在于测试进程。
import { randomUUID } from 'node:crypto';
import { m2Fixture, listing, directory } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { envelope, file } from './openlist-fixture.js';
import type { CapturedCall, Reply } from './openlist-fixture.js';
import type { Environment } from '../src/configuration/validation.js';
import { object, string } from '../src/openlist/errors.js';

/** F1正在接收的会话。 */
interface Session {
  /** 上游会话ID。 */
  id: string;
  /** 目标路径。 */
  path: string;
  /** 计划大小。 */
  size: number;
  /** 收到的原始分片。 */
  chunks: Map<number, Buffer>;
}
/** 可制造响应丢失但保留副作用的测试服务。 */
export interface RelayFixture extends M2Fixture {
  /** 目录以null表示，文件以Buffer表示。 */
  files: Map<string, Buffer | null>;
  /** 改写正常响应；调用时正常副作用已经发生。 */
  fault?: (call: CapturedCall, response: Reply) => Reply | Promise<Reply>;
  /** 完整正常请求处理，可供故障用例调用。 */
  respond: (call: CapturedCall) => Reply;
}
/** 构造与真实协议匹配的分片快照。
 * @param session 当前会话。
 * @param state 原始上游状态。
 * @returns JSON快照。
 * @throws 不适用。
 */
function snapshot(session: Session, state = 'receiving') {
  const received = [...session.chunks.keys()].sort(
    /** 按chunk编号排序以生成连续received区间。
     * @param a 左侧chunk编号或编号与内容。
     * @param b 右侧chunk编号或编号与内容。
     * @returns 按编号升序比较的数值。
     * @throws 不适用。
     */
    (a, b) => a - b,
  );
  const ranges: [number, number][] = [];
  for (const index of received) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] + 1 === index) last[1] = index;
    else ranges.push([index, index]);
  }
  return {
    upload_id: session.id,
    state,
    attempt: 0,
    chunk_size: 1048576,
    total_chunks: Math.ceil(session.size / 1048576),
    received: ranges,
    received_bytes: [...session.chunks.values()].reduce(
      /** 累计已接收chunk的字节数。
       * @param sum 已累计字节数。
       * @param bytes 当前chunk原始字节。
       * @returns 累计payload字节数。
       * @throws 不适用。
       */
      (sum, bytes) => sum + bytes.length,
      0,
    ),
    frontier: received.length,
  };
}
/** 建立真实Nest/SQLite与有实际副作用的F1。
 * @param settings 本用例配置差异。
 * @returns 测试夹具。
 * @throws Error 应用或测试HTTP初始化失败。
 */
export async function relayFixture(
  settings: Environment = {},
): Promise<RelayFixture> {
  const base = await m2Fixture({ SPOOL_RESERVE_BYTES: '0', ...settings });
  const files = new Map<string, Buffer | null>([
    ['/', null],
    ['/source', null],
    ['/target', null],
    ['/source/new.txt', Buffer.from('hello relay!')],
  ]);
  const sessions = new Map<string, Session>();
  const fixture: RelayFixture = Object.assign(base, { files, respond });
  /** 返回当前路径条目，不提供任何真实凭据。
   * @param path 账号文件路径。
   * @returns 协议对象。
   * @throws Error 用例引用不存在的路径。
   */
  function entry(path: string): Record<string, unknown> {
    const content = files.get(path);
    if (content === undefined) throw new Error('Fixture entry missing');
    const name = path.slice(path.lastIndexOf('/') + 1);
    return content === null
      ? directory(name)
      : { ...file(name), size: content.length };
  }
  /** 单请求协议及副作用，响应可在之后被fault改写。
   * @param call 实际HTTP请求。
   * @returns 正常响应。
   * @throws Error 测试请求格式不符合协议。
   */
  function respond(call: CapturedCall): Reply {
    const path =
      call.json && typeof call.json === 'object' && 'path' in call.json
        ? String(call.json.path)
        : '';
    if (call.url === '/api/fs/list') {
      if (files.get(path) !== null) return envelope(null, 500);
      const prefix = path === '/' ? '/' : path + '/';
      return listing(
        ...[...files.keys()]
          .filter(
            /** 筛选当前目录直接子条目，保持真实列表层级。
             * @param key 当前账号文件路径。
             * @returns 满足上述请求或操作条件时返回true。
             * @throws 不适用。
             */
            (key) =>
              key.startsWith(prefix) &&
              key !== path &&
              !key.slice(prefix.length).includes('/'),
          )
          .map(entry),
      );
    }
    if (call.url === '/api/fs/get')
      return files.has(path) ? envelope(entry(path)) : envelope(null, 500);
    if (call.url.startsWith('/d/') || call.url.startsWith('/p/')) {
      const full = decodeURIComponent(
        new URL(call.url, 'http://fixture').pathname.slice(2),
      );
      const data = files.get(full);
      if (!data) return { status: 404, body: '' };
      const range = /^bytes=(\d+)-$/.exec(String(call.headers.range ?? ''));
      if (range) {
        const start = Number(range[1]);
        if (start >= data.length) return { status: 416, body: '' };
        return {
          status: 206,
          body: data.subarray(start),
          headers: {
            'content-type': 'application/octet-stream',
            'content-range': `bytes ${start}-${data.length - 1}/${data.length}`,
            'content-length': String(data.length - start),
            etag: '"fixture"',
          },
        };
      }
      return {
        body: data,
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(data.length),
          etag: '"fixture"',
        },
      };
    }
    if (call.url === '/api/fs/mkdir') {
      files.set(path, null);
      return envelope(null);
    }
    if (call.url === '/api/fs/remove') {
      const data = object(call.json);
      const parent = string(data.dir);
      const names = data.names;
      if (!Array.isArray(names) || names.length !== 1)
        throw new Error('Expected single remove name');
      files.delete((parent === '/' ? '' : parent) + '/' + String(names[0]));
      return envelope(null);
    }
    if (call.url === '/api/fs/put') {
      files.set(
        decodeURIComponent(String(call.headers['file-path'])),
        Buffer.alloc(0),
      );
      return envelope(null);
    }
    if (call.url === '/api/fs/multipart/init') {
      const path = decodeURIComponent(String(call.headers['file-path']));
      if (files.has(path)) return envelope(null, 403);
      const session: Session = {
        id: randomUUID(),
        path,
        size: Number(call.headers['x-file-size']),
        chunks: new Map(),
      };
      sessions.set(session.id, session);
      files.set(path, Buffer.alloc(0));
      return envelope(snapshot(session));
    }
    if (call.url.startsWith('/api/fs/multipart/')) {
      const id = call.url.includes('status?')
        ? new URL(call.url, 'http://fixture').searchParams.get('upload_id')
        : String(call.headers['x-upload-id']);
      const session = sessions.get(id ?? '');
      if (!session) return envelope(null, 404);
      if (call.url.endsWith('/chunk')) {
        session.chunks.set(Number(call.headers['x-chunk-index']), call.bytes);
        return envelope(snapshot(session));
      }
      if (call.url.endsWith('/complete')) {
        files.set(
          session.path,
          Buffer.concat(
            [...session.chunks]
              .sort(
                /** 按chunk编号恢复文件内容顺序。
                 * @param a 左侧chunk编号或编号与内容。
                 * @param b 右侧chunk编号或编号与内容。
                 * @returns 按编号升序比较的数值。
                 * @throws 不适用。
                 */
                (a, b) => a[0] - b[0],
              )
              .map(
                /** 取得当前chunk的原始字节。
                 * @param item chunk编号与原始内容。
                 * @returns 用于当前断言的字段。
                 * @throws 不适用。
                 */
                (item) => item[1],
              ),
          ),
        );
        sessions.delete(session.id);
        return envelope(snapshot(session, 'completed'));
      }
      if (call.url.endsWith('/abort')) {
        sessions.delete(session.id);
        return envelope(null);
      }
      return envelope(snapshot(session));
    }
    return envelope(null);
  }
  base.server.responder =
    /** 保留基础认证与挂载协议，其余请求执行副作用后再注入故障。
     * @param call 真实HTTP请求及其捕获头。
     * @returns 不适用。
     * @throws 不适用。
     */
    async (call) => {
      if (
        call.url.startsWith('/api/admin/') ||
        call.url === '/api/me' ||
        call.url === '/api/public/settings'
      )
        return undefined;
      const response = respond(call);
      return fixture.fault ? fixture.fault(call, response) : response;
    };
  return fixture;
}
