// 在真实spool写入边界注入OS错误，不占满宿主磁盘或改变容器。
import { writeFile } from 'node:fs/promises';
import { relayFixture } from './relay-fixture.js';
import { terminal, plan } from './m2-fixture.js';

vi.mock(
  'node:fs/promises',
  /** 保留真实文件系统，只有被测writeFile可以定点失败。
   * @param importOriginal 读取未替换的标准库模块。
   * @returns 保留其它原始函数的测试模块。
   * @throws Error 标准库加载失败。
   */
  async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return { ...actual, writeFile: vi.fn(actual.writeFile) };
  },
);

/** 已初始化session的磁盘写入失败须abort，但SQLite结果仍可持久化。
 * @param code 模拟文件系统返回的容量或配额错误。
 * @returns 真实执行的错误分类验证。
 * @throws Error 断言或夹具清理失败。
 */
it.each(['ENOSPC', 'EDQUOT'])(
  'persists and aborts a real spool write %s',
  async (code) => {
    const actual =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      );
    const f = await relayFixture();
    let initialized = false;
    let aborted = false;
    try {
      f.fault =
        /** 在init后开始注入故障，并记录真实abort调用。
         * @param call 当前HTTP请求。
         * @param response 正常响应。
         * @returns 原始协议响应。
         * @throws 不适用。
         */
        (call, response) => {
          if (call.url.endsWith('/init')) initialized = true;
          if (call.url.endsWith('/abort')) aborted = true;
          return response;
        };
      vi.mocked(writeFile).mockImplementation(
        /** 只拒绝init后的临时spool块，密钥等其它文件仍正常写入。
         * @param path 待写入路径或文件句柄。
         * @param data 原始写入内容。
         * @param options 标准库写入选项。
         * @returns 文件写入完成。
         * @throws Error 模拟OS容量/配额错误，或真实文件系统错误。
         */
        async (path, data, options) => {
          if (initialized && typeof path === 'string' && path.endsWith('.tmp'))
            throw Object.assign(new Error('Injected filesystem failure'), {
              code,
            });
          await actual.writeFile(path, data, options);
        },
      );
      const run = await terminal(
        f,
        f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: false })
          .id,
      );
      expect(plan(f, run.id)[0]).toMatchObject({
        status: 'failed',
        error: { code: 'SPOOL_FULL', message: 'spool write ENOSPC/EDQUOT' },
      });
      expect(aborted).toBe(true);
    } finally {
      vi.mocked(writeFile).mockImplementation(actual.writeFile);
      await f.close();
    }
  },
);
