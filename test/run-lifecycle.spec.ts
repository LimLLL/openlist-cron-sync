// 用真实后台扫描、门闩和可控时钟验证排队、超时、重启及关机窗口。
import { eq } from 'drizzle-orm';
import { m2Fixture, listing, preview, terminal, plan } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { file, latch } from './openlist-fixture.js';
import { object } from '../src/openlist/errors.js';
import { DatabaseService } from '../src/database/database.service.js';
import { runs } from '../src/database/run-schema.js';
import { Readiness } from '../src/coordination/coordination.module.js';
import { setImmediate } from 'node:timers/promises';
import { environmentFor, startApplication } from './helpers.js';

/** 用真实后台扫描、门闩和受控时钟覆盖排队占用、队列与运行期限、重启中断及关机窗口。
 * @param 不适用。
 * @returns 不适用。
 * @throws Error 断言失败。
 */
describe('M2 run lifecycle', () => {
  let f: M2Fixture;
  afterEach(
    /** 恢复 mock 与真实计时器后关闭夹具。
     * @param 不适用。
     * @returns 完成 Promise。
     * @throws Error 清理失败。
     */
    async () => {
      vi.restoreAllMocks();
      vi.useRealTimers();
      if (f) await f.close();
    },
  );
  /** 排队中的 Run 持续占用其 Job，队列满时拒绝新触发，无空闲执行位时按队列期限以 QUEUE_TIMEOUT 失败。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('keeps queued Job occupancy, enforces queue capacity and expires without a free execution slot', async () => {
    f = await m2Fixture({
      GLOBAL_MAX_RUNS: '1',
      MAX_QUEUED_RUNS: '1',
      QUEUE_TIMEOUT_SECONDS: '60',
      OPENLIST_API_TIMEOUT_MS: '300000',
    });
    const entered = latch();
    const release = latch();
    const responder = f.server.responder;
    f.server.responder =
      /** 源根列表请求挂起到测试释放门闩，使活动 Run 占住执行位；其余请求交给原 responder。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 原 responder 的结果。
       * @throws OpenListError 请求体不是对象。
       */
      async (call) => {
        if (
          call.url === '/api/fs/list' &&
          object(call.json).path === '/source'
        ) {
          entered.release();
          await release.promise;
        }
        return responder?.(call);
      };
    const expire = captureMinuteDeadline();
    const active = f.runs().trigger(f.job({ timeoutSeconds: 600 }).id, {
      dryRun: true,
      confirmDeletes: false,
    });
    await entered.promise;
    const queuedJob = f.job();
    const queued = f
      .runs()
      .trigger(queuedJob.id, { dryRun: true, confirmDeletes: false });
    expect(
      /** 再次触发已有排队 Run 的 Job。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期的 Job has a non-terminal run。
       */
      () =>
        f.runs().trigger(queuedJob.id, { dryRun: true, confirmDeletes: false }),
    ).toThrow('Job has a non-terminal run');
    expect(
      /** 在队列已满时触发另一个 Job。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期的 Run queue is full。
       */
      () =>
        f.runs().trigger(f.job().id, { dryRun: true, confirmDeletes: false }),
    ).toThrow('Run queue is full');
    await expire();
    expect(f.runs().get(queued.id)).toMatchObject({
      status: 'failed',
      error: { code: 'QUEUE_TIMEOUT' },
      startedAt: null,
      stopReason: null,
    });
    expect(f.runs().get(active.id).status).toBe('scanning');
    release.release();
    vi.useRealTimers();
    await terminal(f, active.id);
  });
  /** 运行期限到达时在本地取消长时间扫描，并取消所有未派发的已落库操作。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('cancels a long scan locally and cancels undispatched operations at timeout', async () => {
    f = await m2Fixture({ OPENLIST_API_TIMEOUT_MS: '300000' });
    f.tree.set(
      '/source',
      listing(file('new'), { ...file('slow'), is_dir: true }),
    );
    const entered = latch();
    const release = latch();
    const responder = f.server.responder;
    f.server.responder =
      /** /source/slow 列表请求挂起到测试释放门闩后返回空列表；其余请求交给原 responder。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 空列表或原 responder 的结果。
       * @throws OpenListError 请求体不是对象。
       */
      async (call) => {
        if (
          call.url === '/api/fs/list' &&
          object(call.json).path === '/source/slow'
        ) {
          entered.release();
          await release.promise;
          return listing();
        }
        return responder?.(call);
      };
    const expire = captureMinuteDeadline();
    const run = f.runs().trigger(f.job({ timeoutSeconds: 60 }).id, {
      dryRun: true,
      confirmDeletes: false,
    });
    await entered.promise;
    expect(plan(f, run.id).length).toBeGreaterThan(0);
    await expire();
    release.release();
    vi.useRealTimers();
    const done = await terminal(f, run.id);
    expect(done).toMatchObject({
      status: 'cancelled',
      stopReason: 'RUN_TIMEOUT',
      stats: { cancelledOperations: 0, succeededCreates: 0 },
    });
    expect(
      plan(f, run.id).every(
        /** 检查操作已取消。
         * @param op 计划操作视图。
         * @returns 是否为 cancelled。
         * @throws 不适用。
         */
        (op) => op.status === 'cancelled',
      ),
    ).toBe(true);
    expect(
      Date.parse(done.deadlineAt ?? '') - Date.parse(done.startedAt ?? ''),
    ).toBe(60000);
  });
  /** 重启时把遗留的非终态 Run 以 PROCESS_RESTART 中断，不重放待执行操作，并释放 Job 占用。
   * @param status 重启前写入的非终态。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it.each(['scanning', 'planned'] as const)(
    'interrupts old %s without replaying pending work',
    async (status) => {
      f = await m2Fixture();
      const job = f.job();
      const original = await preview(f, job);
      f.app
        .get(DatabaseService)
        .db.update(runs)
        .set({ status, endedAt: null })
        .where(eq(runs.id, original.id))
        .run();
      const before = f.server.calls.length;
      await f.restart();
      const run = f.runs().get(original.id);
      expect(run).toMatchObject({
        status: 'interrupted',
        stopReason: 'PROCESS_RESTART',
      });
      expect(
        plan(f, run.id).every(
          /** 检查操作因计划中断而跳过。
           * @param op 计划操作视图。
           * @returns 是否为 PLAN_INTERRUPTED 跳过。
           * @throws 不适用。
           */
          (op) =>
            op.status === 'skipped' && op.error?.code === 'PLAN_INTERRUPTED',
        ),
      ).toBe(true);
      expect(f.server.calls.length).toBe(before);
      expect(f.jobs().patch(job.id, { name: 'No longer busy' }).name).toBe(
        'No longer busy',
      );
    },
  );
  /** 关机时扫描中的 Run 保持非终态并忽略迟到响应；重启后活动 Run 被中断，排队 Run 按原快照的设置与源密码执行。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('shutdown leaves scanning nonterminal, ignores a late response, and queued restart uses its original snapshot', async () => {
    f = await m2Fixture({
      GLOBAL_MAX_RUNS: '1',
      SCAN_MAX_DIRECTORY_ENTRIES: '3',
      OPENLIST_API_TIMEOUT_MS: '300000',
    });
    const entered = latch();
    const release = latch();
    const responder = f.server.responder;
    f.server.responder =
      /** 源根列表请求挂起到测试释放门闩，使活动 Run 占住执行位；其余请求交给原 responder。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 原 responder 的结果。
       * @throws OpenListError 请求体不是对象。
       */
      async (call) => {
        if (
          call.url === '/api/fs/list' &&
          object(call.json).path === '/source'
        ) {
          entered.release();
          await release.promise;
        }
        return responder?.(call);
      };
    const active = f
      .runs()
      .trigger(f.job().id, { dryRun: true, confirmDeletes: false });
    await entered.promise;
    const queued = f.runs().trigger(
      f.job({
        source: {
          instanceId: f.id,
          path: '/source',
          password: 'snapshot-path-secret',
        },
        targets: [
          { instanceId: f.id, path: '/target', createMode: 'server_copy' },
          { instanceId: f.id, path: '/target-relay', createMode: 'relay' },
        ],
      }).id,
      { dryRun: true, confirmDeletes: false },
    );
    await f.app.close();
    release.release();
    f.server.responder = responder;
    f.tree.set('/source', listing(file('a'), file('b')));
    f.tree.set('/target-relay', listing());
    f.app = await startApplication(
      environmentFor(f.directory.path, {
        GLOBAL_MAX_RUNS: '1',
        SCAN_MAX_DIRECTORY_ENTRIES: '1',
        OPENLIST_MAX_JSON_BYTES: '1024',
        RETRY_MAX_ATTEMPTS: '1',
      }),
    );
    expect(f.runs().get(active.id)).toMatchObject({
      status: 'interrupted',
      stopReason: 'PROCESS_RESTART',
    });
    const done = await terminal(f, queued.id);
    expect(done.status).toBe('succeeded');
    expect(done.config.settings.scanMaxDirectoryEntries).toBe(3);
    expect(
      done.targets.map((target) => target.config.target.createMode),
    ).toEqual(['server_copy', 'relay']);
    expect(new Set(plan(f, done.id).map((op) => op.method))).toEqual(
      new Set(['server_copy', 'relay']),
    );
    expect(done.createdAt).toBe(queued.createdAt);
    expect(done.queueDeadlineAt).toBe(queued.queueDeadlineAt);
    expect(
      f.server.calls.some(
        /** 检查列表请求携带了快照中的源路径密码。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 是否为带 snapshot-path-secret 的列表请求。
         * @throws OpenListError 请求体不是对象。
         */
        (call) =>
          call.url === '/api/fs/list' &&
          object(call.json).password === 'snapshot-path-secret',
      ),
    ).toBe(true);
    expect(JSON.stringify(done)).not.toContain('snapshot-path-secret');
  });
  /** 恢复完成前拒绝触发，且不留下任何 Run 记录。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('rejects trigger before recovery', async () => {
    f = await m2Fixture();
    const job = f.job();
    const readiness = f.app.get(Readiness);
    readiness.recovered = false;
    expect(
      /** 在恢复完成前触发 dry-run。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期的 Run dispatcher is not ready。
       */
      () => f.runs().trigger(job.id, { dryRun: true, confirmDeletes: false }),
    ).toThrow('Run dispatcher is not ready');
    readiness.recovered = true;
    expect(f.runs().list({ page: 1, pageSize: 50 }).total).toBe(0);
  });
});

/** 只推进业务一分钟期限，真实网络与实例速率计时保持运行。
 * @param 不适用。
 * @returns 到期触发函数。
 * @throws Error 业务计时器未安装。
 */
function captureMinuteDeadline(): () => Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] });
  const original = globalThis.setTimeout;
  let expire: (() => void) | undefined;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(
    /** 照常创建真实计时器，并记录约一分钟的业务期限以便测试手动触发。
     * @param callback 计时器回调。
     * @param delay 延迟毫秒数。
     * @param args 透传给回调的参数。
     * @returns 真实计时器句柄。
     * @throws 不适用。
     */
    (callback, delay, ...args) => {
      const timer = original(callback, delay, ...args);
      if (delay !== undefined && delay > 59000 && delay <= 60000)
        expire =
          /** 清除真实计时器并立即执行业务期限回调。
           * @param 不适用。
           * @returns 不适用。
           * @throws 不适用。
           */
          () => {
            clearTimeout(timer);
            callback(...args);
          };
      return timer;
    },
  );
  /** 触发已记录的业务期限，同时推进墙上时钟。
   * @param 不适用。
   * @returns 到期收尾完成。
   * @throws Error 期限未安装。
   */
  async function expireDeadline(): Promise<void> {
    await setImmediate();
    if (!expire) throw new Error('Missing minute deadline');
    vi.setSystemTime(Date.now() + 60000);
    expire();
    await setImmediate();
  }
  return expireDeadline;
}
