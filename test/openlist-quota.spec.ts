// 验证配额控制优先、取消释放，以及所有管理请求共享真实限速。
import { ApiQuota } from '../src/coordination/api-quota.service.js';
import { InstancesService } from '../src/instances/instances.service.js';
import { InstanceOperations } from '../src/instances/instance-operations.service.js';
import { componentFixture } from './openlist-fixture.js';

describe('M1 per-instance quota', /** 注册本组 M1 行为验收用例。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
() => {
  afterEach(
    /** 恢复测试状态并释放本用例拥有的资源。
     * @param 不适用。
     * @returns 清理完成；异步资源返回 Promise。
     * @throws Error 资源清理失败。
     */
    () => {
      vi.useRealTimers();
    },
  );
  it('reserves control capacity, obeys rate, cancels queued requests and releases slots', /** 记录实际取得配额的顺序。
   * @param 不适用。
   * @returns 调用方负责释放的函数。
   * @throws 不适用。
   */
  async () => {
    vi.useFakeTimers();
    const quota = new ApiQuota();
    const limits = {
      id: 'instance',
      maxApiConcurrency: 2,
      apiRequestsPerSecond: 10,
    };
    const signal = new AbortController().signal;
    const releaseFirst = await quota.acquire(limits, false, signal);
    const order: string[] = [];
    const submit = quota.acquire(limits, false, signal).then(
      /** 记录实际取得配额的顺序。
       * @param release 已获得名额的释放函数。
       * @returns 调用方负责释放的函数。
       * @throws 不适用。
       */
      (release) => {
        order.push('submit');
        return release;
      },
    );
    const control = quota.acquire(limits, true, signal).then(
      /** 记录实际取得配额的顺序。
       * @param release 已获得名额的释放函数。
       * @returns 调用方负责释放的函数。
       * @throws 不适用。
       */
      (release) => {
        order.push('control');
        return release;
      },
    );
    await vi.advanceTimersByTimeAsync(100);
    const releaseControl = await control;
    expect(order).toEqual(['control']);
    const cancel = new AbortController();
    const queued = quota.acquire(limits, true, cancel.signal);
    const rejected = expect(queued).rejects.toMatchObject({
      name: 'AbortError',
    });
    cancel.abort();
    await rejected;
    releaseControl();
    releaseFirst();
    await vi.advanceTimersByTimeAsync(100);
    const releaseSubmit = await submit;
    expect(order).toEqual(['control', 'submit']);
    releaseSubmit();
    releaseSubmit();
    const other = await quota.acquire(
      { ...limits, id: 'other' },
      false,
      signal,
    );
    other();
  });
  it('drains a large backlog at once after the limits become unlimited', /** 先在并发 1 下积压大量请求，再以 0/0 配额一次派发，防止逐个递归派发撑爆调用栈。
   * @param 不适用。
   * @returns 断言完成。
   * @throws Error 断言失败。
   */
  async () => {
    const quota = new ApiQuota();
    const signal = new AbortController().signal;
    const finite = {
      id: 'backlog',
      maxApiConcurrency: 1,
      apiRequestsPerSecond: 1000,
    };
    const holder = await quota.acquire(finite, true, signal);
    // 每个请求独立的取消信号，与真实调用一致；共用一个信号会让监听器登记本身变成平方级。
    const backlog = Array.from({ length: 20_000 }, () =>
      quota.acquire(finite, true, new AbortController().signal),
    );
    const unlimited = {
      id: 'backlog',
      maxApiConcurrency: 0,
      apiRequestsPerSecond: 0,
    };
    const releases = await Promise.all([
      ...backlog,
      quota.acquire(unlimited, false, signal),
    ]);
    expect(releases).toHaveLength(20_001);
    for (const release of releases) release();
    holder();
  });
  it('login, me, settings and admin browse share the same request rate', /** 记录上游实际收到请求的时间。
   * @param 不适用。
   * @returns undefined，使用默认上游响应。
   * @throws 不适用。
   */
  async () => {
    const fixture = await componentFixture();
    try {
      fixture.app
        .get(InstancesService)
        .patch(fixture.id, { limits: { apiRequestsPerSecond: 5 } });
      const times: number[] = [];
      fixture.server.responder =
        /** 记录上游实际收到请求的时间。
         * @param 不适用。
         * @returns undefined，使用默认上游响应。
         * @throws 不适用。
         */
        () => {
          times.push(performance.now());
          return undefined;
        };
      await fixture.app
        .get(InstanceOperations)
        .test(fixture.id, { retryAuth: false });
      await fixture.app.get(InstanceOperations).browse(fixture.id, {
        path: '/',
        refresh: false,
        page: 1,
        pageSize: 50,
      });
      expect(times.length).toBe(6);
      for (let i = 1; i < times.length; i++)
        expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(180);
    } finally {
      await fixture.close();
    }
  });
});
