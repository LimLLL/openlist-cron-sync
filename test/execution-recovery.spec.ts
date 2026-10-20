// 复现崩溃各持久化边界留下的SQLite状态，重启不能重放旧写入。
import { eq } from 'drizzle-orm';
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { terminal, preview, plan } from './m2-fixture.js';
import { envelope } from './openlist-fixture.js';
import { DatabaseService } from '../src/database/database.service.js';
import { runs } from '../src/database/run-schema.js';
import { operations } from '../src/database/operation-schema.js';
import { OpenListMultipart } from '../src/openlist/multipart.service.js';

/** 注册各持久化窗口的恢复验收。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M3 persisted crash windows', () => {
  let f: RelayFixture;
  /** 每例使用新数据库，状态转换直接来自真实schema。
   * @param 不适用。
   * @returns 夹具就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await relayFixture();
  });
  /** 关闭本测试资源。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    await f.close();
  });
  /** init前、session落库后和EOF落库后的不同窗口不能混淆。
   * @param window 崩溃时最后一个已提交检查点。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it.each([
    'pending',
    'submitting',
    'session',
    'eof',
    'completed',
    'result',
  ] as const)(
    'recovers the %s checkpoint without resuming chunks',
    async (window) => {
      const result = await preview(f, f.job());
      const op = plan(f, result.id)[0];
      const db = f.app.get(DatabaseService).db;
      db.update(runs)
        .set({ status: 'executing', dryRun: false, endedAt: null })
        .where(eq(runs.id, result.id))
        .run();
      if (window === 'submitting')
        db.update(operations)
          .set({ status: 'submitting', submittedAt: Date.now() })
          .where(eq(operations.id, op.id))
          .run();
      if (['session', 'eof', 'completed', 'result'].includes(window)) {
        const session = await f.app
          .get(OpenListMultipart)
          .init(f.record(), { directory: '/target', name: 'new.txt' }, 12);
        db.update(operations)
          .set({
            status: window === 'result' ? 'succeeded' : 'running',
            endedAt: window === 'result' ? Date.now() : null,
            multipartUploadId: session.uploadId,
            multipartChunkSize: session.chunkSize,
            multipartAttempt: session.attempt,
            multipartState: 'receiving',
            sourceStreamCompletedAt: window === 'session' ? null : Date.now(),
          })
          .where(eq(operations.id, op.id))
          .run();
        if (window === 'completed')
          f.fault =
            /** 提供同session的completed证据以测试恢复收敛。
             * @param call 真实HTTP请求及其捕获头。
             * @param response 正常响应；stream回调时为测试HTTP响应。
             * @returns 本故障窗口对应的响应；其它请求保持原响应。
             * @throws 不适用。
             */
            (call, response) =>
              call.url.includes('/multipart/status?')
                ? envelope({
                    upload_id: session.uploadId,
                    state: 'completed',
                    attempt: 0,
                    chunk_size: session.chunkSize,
                    total_chunks: 1,
                    received: [[0, 0]],
                    received_bytes: 12,
                    frontier: 1,
                  })
                : response;
      }
      const before = f.server.calls.length;
      await f.restart();
      expect((await terminal(f, result.id)).status).toBe('interrupted');
      const restored = plan(f, result.id)[0];
      expect(restored.status).toBe(
        window === 'pending'
          ? 'skipped'
          : window === 'completed' || window === 'result'
            ? 'succeeded'
            : 'unknown',
      );
      expect(
        f.server.calls.slice(before).some(
          /** 识别恢复期禁止重放的上传请求。
           * @param call 真实HTTP请求及其捕获头。
           * @returns 满足上述请求或操作条件时返回true。
           * @throws 不适用。
           */
          (call) =>
            call.url.endsWith('/chunk') ||
            call.url.endsWith('/init') ||
            call.url.endsWith('/complete'),
        ),
      ).toBe(false);
    },
  );
  /** 已成功remove但未确认时只读确认，不重复删除或执行旧create。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('confirms a running delete and discards its dependent create', async () => {
    f.files.set('/target/new.txt', Buffer.from('old'));
    const result = await preview(f, f.job(), true);
    const db = f.app.get(DatabaseService).db;
    const deletion = plan(f, result.id).find(
      /** 取得待恢复的替换删除动作。
       * @param op 当前操作视图。
       * @returns 用于当前断言的字段。
       * @throws 不适用。
       */
      (op) => op.action === 'delete',
    );
    if (!deletion) throw new Error('Missing replacement fixture');
    f.files.delete('/target/new.txt');
    db.update(runs)
      .set({ status: 'executing', dryRun: false, endedAt: null })
      .where(eq(runs.id, result.id))
      .run();
    db.update(operations)
      .set({ status: 'running', submittedAt: Date.now() })
      .where(eq(operations.id, deletion.id))
      .run();
    const before = f.server.calls.length;
    await f.restart();
    await terminal(f, result.id);
    expect(
      plan(f, result.id).map(
        /** 提取恢复后各动作状态以验证依赖收尾。
         * @param op 当前操作视图。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (op) => op.status,
      ),
    ).toEqual(['succeeded', 'skipped']);
    expect(
      f.server.calls.slice(before).every(
        /** 确认恢复期间没有remove或init请求。
         * @param call 真实HTTP请求及其捕获头。
         * @returns 满足上述请求或操作条件时返回true。
         * @throws 不适用。
         */
        (call) =>
          !['/api/fs/remove', '/api/fs/multipart/init'].includes(call.url),
      ),
    ).toBe(true);
  });
});
