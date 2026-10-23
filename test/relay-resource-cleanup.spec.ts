// 验证异常收尾释放已取得的spool承诺、连接和Job/Target配额，且不会重复扣减块。
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../src/configuration/app-config.js';
import { RelayResources } from '../src/coordination/relay-resources.js';
import { RelayService } from '../src/relay/relay.service.js';
import type { RelayInput, PreparedTransfer } from '../src/relay/relay-types.js';
import { RelayError } from '../src/relay/errors.js';
import { Spool } from '../src/relay/spool.js';
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { latch } from './openlist-fixture.js';

/** 注册已知资源泄漏和重复释放窗口。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('relay failure cleanup', () => {
  let f: RelayFixture;
  let relay: RelayService;
  let spool: Spool;
  /** 使用默认的Job/Target配额验证资源释放。
   * @param 不适用。
   * @returns 夹具就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await relayFixture();
    relay = f.app.get(RelayService);
    spool = f.app.get(Spool);
  });
  /** 恢复观测替身并关闭自有资源。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    vi.restoreAllMocks();
    await f.close();
  });
  /** 构造与夹具源一致的固定输入；不创建数据库Operation。
   * @param signal 本次准备期限。
   * @returns 真实Relay输入。
   * @throws Error 实例查询失败。
   */
  function input(signal: AbortSignal): RelayInput {
    return {
      operationId: randomUUID(),
      jobId: 'job',
      sourceDownloadConcurrency: 2,
      bandwidth: 0,
      instance: f.record(),
      target: f.record(),
      targetResourceId: 'target',
      targetConcurrentFiles: 2,
      targetChunkConcurrency: 2,
      directory: '/source',
      name: 'new.txt',
      size: 12,
      password: '',
      file: { directory: '/target', name: 'new.txt' },
      settings: f.app.get(AppConfig).execution,
      signal,
    };
  }
  /** 本组只验证资源，不把进度写入不存在的测试Operation。
   * @param _downloaded 已下载字节。
   * @param _transferred 已上传字节。
   * @returns 不适用。
   * @throws 不适用。
   */
  function progress(_downloaded: number, _transferred: number): void {}
  /** 首块空间未取得时不打开源GET，磁盘背压期间不占住源连接。
   * @returns 验证完成。
   * @throws Error 断言或资源操作失败。
   */
  it('reserves the first spool block before opening a source GET', async () => {
    const entered = latch();
    const ready = latch();
    const reserve = spool.reserve.bind(spool);
    vi.spyOn(spool, 'reserve').mockImplementationOnce(async (...args) => {
      entered.release();
      await ready.promise;
      return reserve(...args);
    });
    const prepared = relay.prepare(input(AbortSignal.timeout(5000)), progress);
    await entered.promise;
    expect(f.server.calls.some((call) => call.url.startsWith('/d/'))).toBe(
      false,
    );
    ready.release();
    const transfer = await prepared;
    expect(f.server.calls.some((call) => call.url.startsWith('/d/'))).toBe(
      true,
    );
    await relay.dispose(transfer);
  });
  /** Job/Target资源为零时跳过本地permit，但仍返回幂等释放函数。 */
  it('bypasses zero Job/Target relay permits', async () => {
    const resources = f.app.get(RelayResources);
    const signal = new AbortController().signal;
    const releases = await Promise.all([
      resources.relayFile('job', 'target', 0, 0, signal),
      resources.relayFile('job', 'target', 0, 0, signal),
    ]);
    for (const release of releases) release();
  });
  /** 在Job/Target permit等待时取消，下一文件仍可使用全部容量。
   * @param 不适用。
   * @returns 容量回收验证。
   * @throws Error 断言或资源释放失败。
   */
  it('frees all capacity when cancelled while waiting for a Job source permit', async () => {
    const release = await f.app
      .get(RelayResources)
      .relayFile('job', 'target', 1, 1, new AbortController().signal);
    const stop = new AbortController();
    const preparing = relay.prepare(input(stop.signal), progress);
    try {
      stop.abort();
      await expect(preparing).rejects.toThrow();
    } finally {
      release();
    }
    const next = await relay.prepare(
      input(AbortSignal.timeout(1000)),
      progress,
    );
    await relay.dispose(next);
  });
  /** 源读取和进度落库连续失败不能遗留文件资源。
   * @param 不适用。
   * @returns 下一文件可成功准备。
   * @throws Error 断言失败。
   */
  it('releases file resources when failure progress cannot be persisted', async () => {
    f.fault =
      /** 拒绝源下载，触发失败进度检查点。
       * @param call 当前请求。
       * @param response 正常响应。
       * @returns 下载失败或原响应。
       * @throws 不适用。
       */
      (call, response) =>
        call.url.startsWith('/d/') ? { status: 503, body: '' } : response;
    await expect(
      relay.prepare(
        input(new AbortController().signal),
        /** 模拟记录失败进度时数据库不可写。
         * @param 不适用。
         * @returns 不返回。
         * @throws Error 固定持久化失败。
         */
        () => {
          throw new Error('Progress persistence failed');
        },
      ),
    ).rejects.toThrow('Progress persistence failed');
    f.fault = undefined;
    const next = await relay.prepare(
      input(AbortSignal.timeout(1000)),
      progress,
    );
    await relay.dispose(next);
  });
  /** 后续块清理失败后重入收尾，已清理块不能再从held扣一次。
   * @param 不适用。
   * @returns 清理后容量仍可正确用于新frontier。
   * @throws Error 断言失败。
   */
  it('preserves capacity accounting after partial block cleanup fails', async () => {
    const transfer: PreparedTransfer = await relay.prepare(
      input(new AbortController().signal),
      progress,
    );
    const reservation = await spool.reserve(8, 8, transfer.input.signal, false);
    const second = await spool.publish(
      transfer.input.operationId,
      1,
      Buffer.alloc(8),
      reservation,
    );
    transfer.blocks.add(second);
    spool.unreserve(reservation);
    let failed = false;
    const release = spool.release.bind(spool);
    vi.spyOn(spool, 'release').mockImplementation(
      /** 第一块实际删除成功，第二块只失败一次。
       * @param blocks 待释放块。
       * @returns 本次释放完成。
       * @throws RelayError 注入的第二块清理失败。
       */
      async (blocks) => {
        for (const block of blocks) {
          if (block === second && !failed) {
            failed = true;
            throw new RelayError('SPOOL_IO_ERROR');
          }
          await release([block]);
        }
      },
    );
    await expect(relay.dispose(transfer)).rejects.toMatchObject({
      code: 'SPOOL_IO_ERROR',
    });
    await relay.dispose(transfer);
    vi.spyOn(spool, 'available').mockResolvedValue(25);
    const next = await spool.reserve(20, 20, AbortSignal.timeout(1000), true);
    spool.unreserve(next);
  });
});
