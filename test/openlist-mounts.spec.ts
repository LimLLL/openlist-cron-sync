// 验证完整 storage 分页、歧义挂载和敏感字段丢弃。
import { Logger } from '@nestjs/common';
import {
  resolveMount,
  effectiveMount,
  storagePage,
} from '../src/openlist/mounts.js';
import { InstanceOperations } from '../src/instances/instance-operations.service.js';
import { componentFixture, envelope, storage } from './openlist-fixture.js';
import type { ComponentFixture } from './openlist-fixture.js';

describe('M1 mount mapping' /** 注册本组 M1 行为验收用例。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */, () => {
  let fixture: ComponentFixture;
  afterEach(
    /** 恢复测试状态并释放本用例拥有的资源。
     * @param 不适用。
     * @returns 清理完成；异步资源返回 Promise。
     * @throws Error 资源清理失败。
     */
    async () => {
      vi.restoreAllMocks();
      if (fixture) await fixture.close();
    },
  );

  it.each([
    ['/a.balance1', '/a'],
    ['/a.balance/b', '/a'],
    ['/x.balancesheet', '/x'],
    ['/a.balance/x.balance2', '/a.balance/x'],
  ])(
    'truncates at LastIndex for %s',

    /** 验证当前场景的协议输入、输出与副作用。
     * @param input 输入场景。
     * @param expected 预期结果。
     * @returns 断言完成；异步用例返回完成 Promise。
     * @throws Error 断言或测试资源操作失败。
     */
    (input, expected) => {
      expect(effectiveMount(input)).toBe(expected);
    },
  );
  it('matches path segments, preserves disabled boundaries and refuses ambiguous candidates' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, () => {
    const rows = storagePage({
      total: 5,
      content: [
        storage(1, '/'),
        storage(2, '/a.balance1'),
        storage(3, '/a.balance/b'),
        { ...storage(4, '/disabled'), disabled: true },
        { ...storage(5, '/failed'), status: 'error' },
      ],
    }).content;
    expect(resolveMount(rows, '/a/file')).toMatchObject({
      storage: null,
      candidates: [{ id: 2 }, { id: 3 }],
    });
    expect(resolveMount(rows, '/ab/file').storage?.id).toBe(1);
    expect(resolveMount(rows, '/disabled/file').storage).toBeNull();
    expect(resolveMount(rows, '/failed/file').storage).toBeNull();
    expect(resolveMount(rows, '/').suspect).toBe(true);
    expect(resolveMount(rows, '/independent').suspect).toBe(false);
  });
  it('restarts a changing pagination once and returns the entire consistent map' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    fixture = await componentFixture('token');
    let pages = 0;
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) => {
        if (!call.url.startsWith('/api/admin/storage/list')) return;
        pages++;
        if (pages === 1) return envelope({ content: [storage()], total: 2 });
        if (pages === 2)
          return envelope({ content: [storage(2, '/b')], total: 3 });
        if (pages === 3) return envelope({ content: [storage()], total: 2 });
        return envelope({ content: [storage(2, '/b')], total: 2 });
      };
    const rows = await fixture.client.storages(fixture.record());
    expect(
      rows.map(
        /** 提取用于断言的公开标识字段。
         * @param row 已解析存储事实。
         * @returns 对应的 ID 或名称。
         * @throws 不适用。
         */
        (row) => row.id,
      ),
    ).toEqual([1, 2]);
    expect(pages).toBe(4);
    expect(JSON.stringify(rows)).not.toContain('addition');
  });
  it.each([
    'failure',
    'duplicate',
    'empty',
    'overshoot',
    'missing',
    'invalid-total',
  ])(
    'fails closed for %s, never takes the non-admin path',

    /** 验证当前场景的协议输入、输出与副作用。
     * @param mode 本次认证或故障模式。
     * @returns 断言完成；异步用例返回完成 Promise。
     * @throws Error 断言或测试资源操作失败。
     */
    async (mode) => {
      fixture = await componentFixture('token');
      let calls = 0;
      fixture.server.responder =
        /** 根据请求端点返回本场景的可控上游响应。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 故障响应或 undefined 以使用默认响应。
         * @throws 不适用。
         */
        (call) => {
          if (!call.url.startsWith('/api/admin/storage/list')) return;
          calls++;
          if (mode === 'failure') return envelope(null, 403);
          if (mode === 'duplicate')
            return envelope({ content: [storage()], total: 2 });
          if (mode === 'empty') return envelope({ content: [], total: 1 });
          if (mode === 'overshoot')
            return envelope({ content: [storage(), storage(2)], total: 1 });
          if (mode === 'missing')
            return envelope({
              content: [{ id: 1, addition: 'SECRET' }],
              total: 1,
            });
          return envelope({ content: [], total: -1 });
        };
      await expect(
        fixture.app.get(InstanceOperations).browse(fixture.id, {
          path: '/',
          page: 1,
          pageSize: 50,
          refresh: false,
        }),
      ).rejects.toMatchObject({ code: 'OPENLIST_ERROR' });
      expect(calls).toBe(mode === 'failure' ? 1 : mode === 'duplicate' ? 4 : 2);
      expect(
        fixture.server.calls.some(
          /** 筛选所需端点的实际 HTTP 请求。
           * @param call 捕获的真实 HTTP 请求。
           * @returns 是否匹配该协议端点。
           * @throws 不适用。
           */
          (call) => call.url === '/api/fs/list',
        ),
      ).toBe(false);
    },
  );
  it('never logs storage addition or upstream bodies containing credentials and URLs' /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */, async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(
      /** 捕获日志调用，避免测试重复输出。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      () => undefined,
    );
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(
      /** 捕获日志调用，避免测试重复输出。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      () => undefined,
    );
    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(
      /** 捕获日志调用，避免测试重复输出。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      () => undefined,
    );
    fixture = await componentFixture('token');
    await fixture.client.storages(fixture.record());
    fixture.server.responder =
      /** 筛选所需端点的实际 HTTP 请求。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 是否匹配该协议端点。
       * @throws 不适用。
       */
      (call) =>
        call.url === '/api/fs/list'
          ? {
              body: {
                code: 403,
                message:
                  'Authorization: static-token password=private sign=private https://example.invalid/secret-path?key=secret\u0000',
                data: { addition: 'STORAGE_ADDITION_MUST_NOT_LEAK' },
              },
            }
          : undefined;
    await expect(
      fixture.client.list(fixture.record(), '/'),
    ).rejects.toMatchObject({ message: 'OpenList application code 403' });
    const logs = JSON.stringify([
      log.mock.calls,
      warn.mock.calls,
      debug.mock.calls,
    ]);
    for (const forbidden of [
      'static-token',
      'private',
      'secret-path',
      'addition',
      'STORAGE_ADDITION_MUST_NOT_LEAK',
      'raw_url',
    ])
      expect(logs).not.toContain(forbidden);
  });
});
