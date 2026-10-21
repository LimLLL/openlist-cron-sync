// 在现有文件F1之上模拟copy task，真实HTTP和SQLite仍走生产链路。
import { randomUUID } from 'node:crypto';
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { envelope } from './openlist-fixture.js';
import { object, string } from '../src/openlist/errors.js';
import type { Environment } from '../src/configuration/validation.js';

/** 模拟copy任务状态。 */
export interface CopyTask {
  /** tache原始状态。 */ state: number;
  /** 源路径。 */ source: string;
  /** 目标路径。 */ destination: string;
}
/** server_copy可控F1。 */
export interface CopyFixture extends RelayFixture {
  /** 是否返回任务。 */ withTask: boolean;
  /** 新任务初始状态。 */ initialState: number;
  /** 按tid的任务。 */ tasks: Map<string, CopyTask>;
  /** 原始请求仍可通过fault制造窗口。 */ copyCount: number;
}
/** 生成完整task响应。
 * @param id 任务ID。
 * @param state 原始状态。
 * @returns 协议JSON。
 * @throws 不适用。
 */
export function taskJson(id: string, state: number) {
  return {
    id,
    name: 'fixture copy',
    state,
    status: '',
    progress: 100,
    error: '',
    start_time: null,
    end_time: null,
    total_bytes: 12,
  };
}
/** 创建真实执行所需的可控协议服务。
 * @param settings 本例环境差异。
 * @returns copy夹具。
 * @throws Error 初始化失败。
 */
export async function copyFixture(
  settings: Environment = {},
): Promise<CopyFixture> {
  const base = await relayFixture({
    OPENLIST_TASK_POLL_MS: '500',
    ...settings,
  });
  const f: CopyFixture = Object.assign(base, {
    withTask: true,
    initialState: 2,
    tasks: new Map<string, CopyTask>(),
    copyCount: 0,
  });
  f.server.responder =
    /** 先生成真实副作用，再交fault模拟丢响应。
     * @param call 捕获的HTTP请求。
     * @returns F1响应。
     * @throws Error 测试协议无效。
     */
    async (call) => {
      if (
        call.url.startsWith('/api/admin/') ||
        call.url === '/api/me' ||
        call.url === '/api/public/settings'
      )
        return undefined;
      let response;
      if (call.url === '/api/fs/copy') {
        const body = object(call.json);
        expect(body.overwrite).toBe(false);
        const names = body.names;
        if (!Array.isArray(names) || names.length !== 1)
          throw new Error('Not a single-name copy');
        const name = string(names[0]);
        const source = string(body.src_dir) + '/' + name;
        const destination = string(body.dst_dir) + '/' + name;
        f.copyCount++;
        if (!f.files.has(source)) response = envelope(null, 500);
        else {
          const id = randomUUID();
          const state = f.initialState;
          if (f.withTask) f.tasks.set(id, { state, source, destination });
          if (!f.withTask || state === 2)
            f.files.set(destination, f.files.get(source) ?? null);
          response = envelope(
            f.withTask ? { tasks: [taskJson(id, state)] } : null,
          );
        }
      } else if (call.url.startsWith('/api/task/copy/')) {
        const tid =
          new URL(call.url, 'http://fixture').searchParams.get('tid') ?? '';
        const task = f.tasks.get(tid);
        if (call.url.includes('/delete_some')) {
          const errors: Record<string, string> = {};
          if (!Array.isArray(call.json))
            throw new Error('Invalid task delete body');
          for (const id of call.json) {
            const row = f.tasks.get(string(id));
            if (row && ![2, 4, 7].includes(row.state)) errors[id] = 'running';
            else f.tasks.delete(string(id));
          }
          response = envelope(errors);
        } else if (!task) response = envelope(null, 404);
        else if (call.url.includes('/cancel')) {
          if (![2, 4, 7].includes(task.state)) task.state = 4;
          response = envelope(null);
        } else {
          if (task.state === 2)
            f.files.set(task.destination, f.files.get(task.source) ?? null);
          response = envelope(taskJson(tid, task.state));
        }
      } else response = f.respond(call);
      return f.fault ? f.fault(call, response) : response;
    };
  return f;
}
