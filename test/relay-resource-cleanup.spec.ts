// 验证异常收尾释放已取得的spool承诺、连接和预读准入，且不会重复扣减块。
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../src/configuration/app-config.js';
import { RelayResources } from '../src/coordination/relay-resources.js';
import { InstancesService } from '../src/instances/instances.service.js';
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
  /** 单个准入位使泄漏直接阻塞下一次准备。
   * @param 不适用。
   * @returns 夹具就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await relayFixture({ RELAY_DOWNLOAD_WORKERS: '1' });
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
      jobId: randomUUID(),
      bandwidth: 0,
      instance: f.record(),
      target: f.record(),
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
  /** 每实例资源为零时跳过本地permit，但仍返回幂等释放函数。 */
  it('bypasses zero per-instance relay permits', async () => {
    f.app.get(InstancesService).patch(f.id, {
      limits: {
        maxDownloadConnections: 0,
        maxUploadSessions: 0,
        maxChunkConcurrency: 0,
      },
    });
    const resources = f.app.get(RelayResources);
    const signal = new AbortController().signal;
    const releases = await Promise.all([
      resources.acquire(f.record(), 'download', signal),
      resources.acquire(f.record(), 'session', signal),
      resources.acquire(f.record(), 'chunk', signal),
    ]);
    for (const release of releases) release();
  });
  /** 在预留已成功、worker尚未取得时取消，下一文件仍可使用全部容量。
   * @param 不适用。
   * @returns 容量回收验证。
   * @throws Error 断言或资源释放失败。
   */
  it('returns the reservation when cancelled while waiting for a download worker', async () => {
    vi.spyOn(spool, 'available').mockResolvedValue(12);
    const reserved = latch();
    const reserve = spool.reserve.bind(spool);
    vi.spyOn(spool, 'reserve').mockImplementation(
      /** 在真实预留完成后通知取消方。
       * @param args 原始预留参数。
       * @returns 已登记的预留。
       * @throws Error 真实预留失败。
       */
      async (...args) => {
        const result = await reserve(...args);
        reserved.release();
        return result;
      },
    );
    const release = await f.app
      .get(RelayResources)
      .downloads.acquire(new AbortController().signal);
    const stop = new AbortController();
    const preparing = relay.prepare(input(stop.signal), progress);
    try {
      await reserved.promise;
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
  /** 源读取和进度落库连续失败不能遗留连接或准入名额。
   * @param 不适用。
   * @returns 下一文件可成功准备。
   * @throws Error 断言失败。
   */
  it('releases admission and the source connection when failure progress cannot be persisted', async () => {
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
