// 验证复制任务与 multipart 五端点的原始协议事实。
import { OpenListTasks } from '../src/openlist/tasks.service.js';
import { OpenListMultipart } from '../src/openlist/multipart.service.js';
import { componentFixture, envelope } from './openlist-fixture.js';
import type { ComponentFixture } from './openlist-fixture.js';

/** 构造标准任务协议。
 * @param state tache 状态。
 * @returns 任务 JSON。
 * @throws 不适用。
 */
function task(state: number): Record<string, unknown> {
  return {
    id: 'tid',
    name: 'copy task',
    state,
    status: '',
    progress: 100,
    error: '',
    start_time: null,
    end_time: null,
    total_bytes: 12,
  };
}
/** 构造分片快照；未收到分片时与上游一致返回 Go nil 切片序列化出的 null。
 * @param state 上游状态。
 * @returns 协议 JSON。
 * @throws 不适用。
 */
function snapshot(state = 'receiving'): Record<string, unknown> {
  return {
    upload_id: 'upload',
    state,
    attempt: 1,
    chunk_size: 4,
    total_chunks: 1,
    received: state === 'completed' ? [[0, 0]] : null,
    received_bytes: state === 'completed' ? 4 : 0,
    frontier: state === 'completed' ? 1 : 0,
  };
}

describe('M1 task and multipart protocols', /** 注册本组 M1 行为验收用例。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
() => {
  let fixture: ComponentFixture;
  afterEach(
    /** 恢复测试状态并释放本用例拥有的资源。
     * @param 不适用。
     * @returns 清理完成；异步资源返回 Promise。
     * @throws Error 资源清理失败。
     */
    async () => {
      if (fixture) await fixture.close();
    },
  );
  it('preserves tasks, all tache states, no-task copy, cancellation and per-id cleanup errors', /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */
  async () => {
    fixture = await componentFixture();
    const tasks = fixture.app.get(OpenListTasks);
    const instance = fixture.record();
    let state = 0;
    let withTask = true;
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) => {
        if (call.url === '/api/fs/copy')
          return envelope(
            withTask ? { tasks: [task(state)] } : { message: 'done' },
          );
        if (call.url.startsWith('/api/task/copy/info'))
          return envelope(task(state));
        if (call.url === '/api/task/copy/delete_some')
          return envelope({
            tid: 'task not found https://secret.invalid/credential',
          });
        return;
      };
    expect(
      await tasks.copy(instance, '/source', '/target', 'file'),
    ).toMatchObject([{ id: 'tid', state: 0 }]);
    for (state = 0; state <= 9; state++)
      expect((await tasks.info(instance, 'tid')).state).toBe(state);
    await expect(tasks.info(instance, 'tid')).rejects.toMatchObject({
      code: 'UPSTREAM_PROTOCOL_ERROR',
    });
    withTask = false;
    expect(await tasks.copy(instance, '/source', '/target', 'file')).toEqual(
      [],
    );
    await tasks.cancel(instance, 'tid');
    expect(await tasks.deleteSome(instance, ['tid'])).toEqual({
      tid: 'OpenList task cleanup rejected',
    });
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) =>
        call.url === '/api/task/copy/delete_some' ? envelope({}) : undefined;
    expect(await tasks.deleteSome(instance, ['tid'])).toEqual({});
    expect(
      fixture.server.calls.some(
        /** 筛选所需端点的实际 HTTP 请求。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 是否匹配该协议端点。
         * @throws 不适用。
         */
        (call) => /retry|clear_/.test(call.url),
      ),
    ).toBe(false);
  });
  it('implements all five multipart endpoints with exact headers and no automatic replay', /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */
  async () => {
    fixture = await componentFixture();
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) => {
        if (call.url === '/api/fs/multipart/abort') return envelope(null);
        if (call.url.startsWith('/api/fs/multipart/'))
          return envelope(
            snapshot(
              call.url.endsWith('/complete') ? 'completed' : 'receiving',
            ),
          );
        return;
      };
    const uploads = fixture.app.get(OpenListMultipart);
    const instance = fixture.record();
    const started = await uploads.init(
      instance,
      {
        directory: '/target',
        name: '中%+.txt',
        modified: '2026-10-19T00:00:00Z',
      },
      4,
    );
    expect(started).toMatchObject({
      uploadId: 'upload',
      chunkSize: 4,
      state: 'receiving',
      received: [],
    });
    await uploads.chunk(
      instance,
      'upload',
      0,
      Buffer.from('data'),
      AbortSignal.timeout(2000),
    );
    await uploads.status(instance, 'upload');
    expect(
      (await uploads.complete(instance, 'upload', AbortSignal.timeout(2000)))
        .state,
    ).toBe('completed');
    await uploads.abort(instance, 'upload');
    const init = fixture.server.calls.find(
      /** 筛选所需端点的实际 HTTP 请求。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 是否匹配该协议端点。
       * @throws 不适用。
       */
      (call) => call.url.endsWith('/init'),
    );
    expect(init?.headers).toMatchObject({
      'x-file-size': '4',
      overwrite: 'false',
      'last-modified': String(Date.parse('2026-10-19T00:00:00Z')),
    });
    expect(decodeURIComponent(String(init?.headers['file-path']))).toBe(
      '/target/中%+.txt',
    );
    expect(init?.headers['x-chunk-size']).toBeUndefined();
    expect(init?.headers['content-type']).toBeUndefined();
    const chunk = fixture.server.calls.find(
      /** 筛选所需端点的实际 HTTP 请求。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 是否匹配该协议端点。
       * @throws 不适用。
       */
      (call) => call.url.endsWith('/chunk'),
    );
    expect(chunk?.headers).toMatchObject({
      'x-upload-id': 'upload',
      'x-chunk-index': '0',
      'content-length': '4',
    });
    expect(chunk?.bytes.toString()).toBe('data');
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) =>
        call.url.endsWith('/chunk') ? envelope(snapshot(), 409) : undefined;
    await expect(
      uploads.chunk(
        instance,
        'upload',
        0,
        Buffer.from('data'),
        AbortSignal.timeout(2000),
      ),
    ).rejects.toMatchObject({ upstreamCode: 409 });
    expect(
      fixture.server.calls.filter(
        /** 筛选所需端点的实际 HTTP 请求。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 是否匹配该协议端点。
         * @throws 不适用。
         */
        (call) => call.url.endsWith('/chunk'),
      ),
    ).toHaveLength(2);
  });
  it('retains unexpected put tasks so the executor can record the remote tid', /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */
  async () => {
    fixture = await componentFixture();
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) =>
        call.url === '/api/fs/put' ? envelope({ task: task(0) }) : undefined;
    expect(
      await fixture.app
        .get(OpenListMultipart)
        .putEmpty(fixture.record(), { directory: '/', name: 'empty' }),
    ).toMatchObject([{ id: 'tid' }]);
  });
});
