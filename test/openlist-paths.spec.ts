// 验证非法名称阻断与路径、下载签名的编码往返。
import { OpenListTasks } from '../src/openlist/tasks.service.js';
import { OpenListMultipart } from '../src/openlist/multipart.service.js';
import { downloadUrl } from '../src/openlist/paths.js';
import { componentFixture, envelope, file } from './openlist-fixture.js';
import type { ComponentFixture } from './openlist-fixture.js';
describe('M1 path boundaries' /** 注册本组 M1 行为验收用例。
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
      if (fixture) await fixture.close();
    },
  );
  it('invalid names never enter names, File-Path or download URLs' /** 检查所有排除条目的固定警告码。
   * @param 不适用。
   * @returns 警告是否为 INVALID_NAME。
   * @throws 不适用。
   */, async () => {
    fixture = await componentFixture();
    const names = ['a/b', 'a\\b', '..\\x', '..\\..\\x', '.', '..'];
    fixture.server.responder =
      /** 根据请求端点返回本场景的可控上游响应。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 故障响应或 undefined 以使用默认响应。
       * @throws 不适用。
       */
      (call) =>
        call.url === '/api/fs/list'
          ? envelope({
              content: [...names.map(file), file('valid'), file('@sync')],
              total: names.length + 2,
              write: true,
            })
          : undefined;
    const result = await fixture.client.list(fixture.record(), '/');
    expect(
      result.items.map(
        /** 提取用于断言的公开标识字段。
         * @param entry 合法文件条目。
         * @returns 对应的 ID 或名称。
         * @throws 不适用。
         */
        (entry) => entry.name,
      ),
    ).toEqual(['valid']);
    expect(result.warnings).toHaveLength(names.length + 1);
    expect(
      result.warnings.every(
        /** 检查所有排除条目的固定警告码。
         * @param warning 安全警告。
         * @returns 警告是否为 INVALID_NAME。
         * @throws 不适用。
         */
        (warning) => warning.code === 'INVALID_NAME',
      ),
    ).toBe(true);
    const before = fixture.server.calls.length;
    const instance = fixture.record();
    for (const name of names) {
      await expect(
        fixture.client.remove(instance, '/', name),
      ).rejects.toMatchObject({ code: 'INVALID_NAME' });
      await expect(
        fixture.app.get(OpenListTasks).copy(instance, '/', '/target', name),
      ).rejects.toMatchObject({ code: 'INVALID_NAME' });
      await expect(
        fixture.app
          .get(OpenListMultipart)
          .init(instance, { directory: '/', name }, 1),
      ).rejects.toMatchObject({ code: 'INVALID_NAME' });
      await expect(
        fixture.app
          .get(OpenListMultipart)
          .putEmpty(instance, { directory: '/', name }),
      ).rejects.toMatchObject({ code: 'INVALID_NAME' });
      for (const mode of ['d', 'p'] as const)
        expect(
          /** 构造下载地址，验证非法名称在本地被拒绝。
           * @param 不适用。
           * @returns 合法时的下载 URL。
           * @throws OpenListError 名称非法。
           */
          () => downloadUrl(instance.baseUrl, '/', '/', name, 'secret', mode),
        ).toThrow('Invalid OpenList entry name');
    }
    expect(fixture.server.calls).toHaveLength(before);
  });

  it('round trips percent, plus, hash, query, Chinese, emoji and spaces once' /** 构造下载地址，验证非法名称在本地被拒绝。
   * @param 不适用。
   * @returns 合法时的下载 URL。
   * @throws OpenListError 名称非法。
   */, async () => {
    fixture = await componentFixture();
    const name = '% + # ? 中文 😀 space';
    const directory = '/目录 +%';
    const sign = '% + # ? 密钥😀';
    const instance = fixture.record();
    await fixture.client.remove(instance, directory, name);
    await fixture.app
      .get(OpenListMultipart)
      .putEmpty(instance, { directory, name });
    const remove = fixture.server.calls.find(
      /** 筛选所需端点的实际 HTTP 请求。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 是否匹配该协议端点。
       * @throws 不适用。
       */
      (call) => call.url === '/api/fs/remove',
    );
    expect(remove?.json).toEqual({ dir: directory, names: [name] });
    const put = fixture.server.calls.find(
      /** 筛选所需端点的实际 HTTP 请求。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 是否匹配该协议端点。
       * @throws 不适用。
       */
      (call) => call.url === '/api/fs/put',
    );
    expect(decodeURIComponent(String(put?.headers['file-path']))).toBe(
      directory + '/' + name,
    );
    expect(put?.headers['content-type']).toBeUndefined();
    expect(put?.headers['as-task']).toBe('false');
    expect(put?.headers.overwrite).toBe('false');
    for (const mode of ['d', 'p'] as const) {
      const url = new URL(
        downloadUrl(instance.baseUrl, '/account', directory, name, sign, mode),
      );
      expect(decodeURIComponent(url.pathname)).toBe(
        `/proxy/${mode}/account${directory}/${name}`,
      );
      expect(url.searchParams.get('sign')).toBe(sign);
    }
  });
});
