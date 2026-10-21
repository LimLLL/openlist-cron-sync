// 驱动真实cron timer回调的迟到和墙钟跳变，不用advanceTimers重放错过的分钟。
import { SchedulerRegistry } from '@nestjs/schedule';
import { copyFixture } from './copy-fixture.js';
import { terminal } from './m2-fixture.js';

/** 注册真实库与注册服务组合的时间窗口测试。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('cron delayed timer delivery', () => {
  /** 长延迟以及重挂过程中的时钟跳变，都最多接受原先挂起的一次Run。
   * @param race 是否在库计算下一期限中途跳时钟。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it.each([false, true])(
    'accepts one theoretical occurrence, clock race=%s',
    async (race) => {
      const f = await copyFixture();
      const originalSet = globalThis.setTimeout;
      const originalClear = globalThis.clearTimeout;
      const callbacks: Array<() => void> = [];
      let runId: string | undefined;
      try {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
          /** 只捕获timer交付函数，持有已清除的真实handle以匹配Node API。
           * @param callback timer函数。
           * @param _delay 库计算的延迟。
           * @param args 原始调用参数。
           * @returns 已清除的合法handle。
           * @throws 不适用。
           */
          (callback, _delay, ...args) => {
            const handle = originalSet(
              /** 构造合法handle，不实际执行。
               * @param 不适用。
               * @returns 不适用。
               * @throws 不适用。
               */
              () => {},
              2147483647,
            );
            originalClear(handle);
            callbacks.push(callback.bind(undefined, ...args));
            return handle;
          },
        );
        const job = f.job({
          createMode: 'server_copy',
          enabled: true,
          cron: '* * * * *',
        });
        const cron = f.app.get(SchedulerRegistry).getCronJob(job.id);
        if (race) {
          vi.spyOn(cron.cronTime, 'getTimeout').mockImplementationOnce(
            /** 模拟重挂计算期间墙钟前跳，使库取得已迟100ms的期限。
             * @param 不适用。
             * @returns 触发库threshold分支的负延迟。
             * @throws 不适用。
             */
            () => {
              vi.setSystemTime(new Date('2026-01-01T00:02:00.100Z'));
              return -100;
            },
          );
        }
        vi.setSystemTime(
          new Date(race ? '2026-01-01T00:01:00Z' : '2026-01-01T00:03:10Z'),
        );
        const delivery = callbacks.shift();
        if (!delivery) throw new Error('Timer missing');
        delivery();
        const accepted = f.runs().list({ page: 1, pageSize: 50 }).items;
        expect(accepted).toHaveLength(1);
        expect(accepted[0].scheduledAt).toBe('2026-01-01T00:01:00.000Z');
        runId = accepted[0].id;
        spy.mockRestore();
        vi.restoreAllMocks();
        vi.useRealTimers();
        f.jobs().setEnabled(job.id, false);
        await terminal(f, runId);
      } finally {
        vi.restoreAllMocks();
        vi.useRealTimers();
        await f.close();
      }
    },
  );
});
