// 验证单进程 storage FIFO、公平性、取消及跨 Run 保留的开始时间。
import {
  ScanPacing,
  scanInterval,
} from '../src/coordination/scan-pacing.service.js';
import type { ScanInterval } from '../src/coordination/scan-pacing.service.js';

/** 取得顺序后立即记录一次实际开始，不持有响应期容量。
 * @param pacing 本例共享服务。
 * @param interval 调用方间隔。
 * @param signal 当前调用方取消。
 * @returns 单调时钟上的实际开始时间。
 * @throws Error 调用方取消。
 */
async function start(
  pacing: ScanPacing,
  interval: ScanInterval,
  signal = new AbortController().signal,
): Promise<number> {
  const finish = await pacing.acquire(interval, signal);
  try {
    finish(true);
    return performance.now();
  } finally {
    finish(false);
  }
}

/** 关闭虚拟计时器，避免泄漏到真实 HTTP 用例。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
afterEach(() => vi.useRealTimers());

/** 全局账号根参与分组，Job、Target 和角色不参与；不同 Instance 不共享。
 * @param 不适用。
 * @returns 不适用。
 * @throws Error 断言失败。
 */
it('groups source and target subdirectories by instance and global first segment', () => {
  const instance = { id: 'one', accountBasePath: '/drive/team' };
  expect(scanInterval(instance, '/source', 1).key).toBe(
    scanInterval(instance, '/target', 3).key,
  );
  expect(scanInterval(instance, '/', 0).key).toBe(
    scanInterval({ ...instance, accountBasePath: '/' }, '/drive/other', 0).key,
  );
  expect(scanInterval(instance, '/', 0).key).not.toBe(
    scanInterval({ ...instance, id: 'two' }, '/', 0).key,
  );
  expect(
    scanInterval({ ...instance, accountBasePath: '/' }, '/', 0).key,
  ).not.toBe(scanInterval(instance, '/', 0).key);
});

/** 混合间隔依次使用各调用方的值；零间隔不能越过先到的请求。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('uses FIFO and each caller interval without holding response concurrency', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const pacing = new ScanPacing();
  const first = await start(pacing, { key: 'shared', seconds: 0 });
  const long = start(pacing, { key: 'shared', seconds: 2 });
  const zero = start(pacing, { key: 'shared', seconds: 0 });
  const short = start(pacing, { key: 'shared', seconds: 1 });
  expect(await start(pacing, { key: 'other', seconds: 3600 })).toBe(first);
  await vi.advanceTimersByTimeAsync(3000);
  expect(await Promise.all([long, zero, short])).toEqual([
    first + 2000,
    first + 2000,
    first + 3000,
  ]);
  pacing.onModuleDestroy();
});

/** 取消队首不消耗开始时间；后继只对最后实际开始计算剩余等待。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('removes a deadline-expired FIFO head without reserving a future timestamp', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const pacing = new ScanPacing();
  const first = await start(pacing, { key: 'shared', seconds: 0 });
  const stop = new AbortController();
  const cancelled = start(
    pacing,
    { key: 'shared', seconds: 3600 },
    stop.signal,
  );
  const rejection = expect(cancelled).rejects.toMatchObject({
    name: 'AbortError',
  });
  const next = start(pacing, { key: 'shared', seconds: 1 });
  await vi.advanceTimersByTimeAsync(900);
  stop.abort();
  await rejection;
  await vi.advanceTimersByTimeAsync(100);
  expect(await next).toBe(first + 1000);
  // 上一个 Run 已结束也不清除历史；新调用方可以要求更长间隔。
  await vi.advanceTimersByTimeAsync(1000);
  const later = start(pacing, { key: 'shared', seconds: 3 });
  await vi.advanceTimersByTimeAsync(2000);
  expect(await later).toBe(first + 4000);
  pacing.onModuleDestroy();
});

/** 取得顺序后、实际派发前取消仍不得记录开始；关闭同时收敛全部等待。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error 断言失败。
 */
it('cancels a granted turn and rejects queued and new work on shutdown', async () => {
  const pacing = new ScanPacing();
  const stop = new AbortController();
  const turn = await pacing.acquire(
    { key: 'shared', seconds: 3600 },
    stop.signal,
  );
  stop.abort();
  expect(() => turn(true)).toThrow();
  turn(false);
  await start(pacing, { key: 'shared', seconds: 3600 });
  const queued = start(pacing, { key: 'shared', seconds: 3600 });
  const rejection = expect(queued).rejects.toMatchObject({
    name: 'AbortError',
  });
  pacing.onModuleDestroy();
  await rejection;
  expect(() =>
    pacing.acquire({ key: 'other', seconds: 0 }, new AbortController().signal),
  ).toThrow();
});
