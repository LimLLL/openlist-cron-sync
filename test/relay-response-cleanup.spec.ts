// 验证上游提前响应、超长Retry-After与非法跳转不会泄漏本地工作或升级为Run实现错误。
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AppConfig } from '../src/configuration/app-config.js';
import { RelayResources } from '../src/coordination/relay-resources.js';
import { OpenListError } from '../src/openlist/errors.js';
import { OpenListMultipart } from '../src/openlist/multipart.service.js';
import { uploadChunk } from '../src/relay/chunk-upload.js';
import { RelayService } from '../src/relay/relay.service.js';
import { relayFixture } from './relay-fixture.js';
import type { RelayFixture } from './relay-fixture.js';
import { terminal, plan } from './m2-fixture.js';

/** 注册响应边界行为；其它F1用例负责完整HTTP传输协议。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('relay response cleanup', () => {
  let f: RelayFixture;
  /** 每个用例独立应用与数据库。
   * @param 不适用。
   * @returns 夹具就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await relayFixture();
  });
  /** 恢复替身并关闭自有资源。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 清理失败。
   */
  afterEach(async () => {
    vi.restoreAllMocks();
    await f.close();
  });
  /** 非法Location是上游单文件错误，不应取消整个Run的其它目标。
   * @param 不适用。
   * @returns 分类验证完成。
   * @throws Error 断言失败。
   */
  it('classifies malformed download Location as UPSTREAM_REDIRECT', async () => {
    f.fault =
      /** 保留源get事实，只返回一个无法解析的Location。
       * @param call 当前请求。
       * @param response 原响应。
       * @returns 下载跳转或原响应。
       * @throws 不适用。
       */
      (call, response) =>
        call.url.startsWith('/d/')
          ? { status: 302, headers: { location: 'http://[invalid' }, body: '' }
          : response;
    const run = await terminal(
      f,
      f.runs().trigger(f.job().id, { dryRun: false, confirmDeletes: false }).id,
    );
    expect(run.error).toBeNull();
    expect(plan(f, run.id)[0]).toMatchObject({
      status: 'failed',
      error: { code: 'UPSTREAM_REDIRECT' },
    });
  });
  /** 完整流结束前的错误响应必须中止并等待还在限速的payload生成器。
   * @param 不适用。
   * @returns worker返回时不存在未结束的生成器读取。
   * @throws Error 断言失败或资源清理失败。
   */
  it('settles a token-blocked upload body before returning its worker', async () => {
    const relay = f.app.get(RelayService);
    const stop = new AbortController();
    const transfer = await relay.prepare(
      {
        operationId: randomUUID(),
        jobId: randomUUID(),
        sourceDownloadConcurrency: 2,
        bandwidth: 1,
        instance: f.record(),
        target: f.record(),
        targetResourceId: randomUUID(),
        targetConcurrentFiles: 2,
        targetChunkConcurrency: 2,
        directory: '/source',
        name: 'new.txt',
        size: 12,
        password: '',
        file: { directory: '/target', name: 'new.txt' },
        settings: f.app.get(AppConfig).execution,
        signal: stop.signal,
      },
      /** 本用例不建立Operation，进度由transfer直接断言。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      () => {},
    );
    const multipart = f.app.get(OpenListMultipart);
    transfer.session = await multipart.init(
      f.record(),
      transfer.input.file,
      12,
    );
    let bodySettled = false;
    let pending: Promise<void> | undefined;
    vi.spyOn(multipart, 'chunk').mockImplementation(
      /** 只消费首个字节，令下一次读取等待令牌后立即返回永久失败。
       * @param _instance 目标实例。
       * @param _id 上传session。
       * @param _index 分片编号。
       * @param body 当前流式body。
       * @returns 不返回正常快照。
       * @throws OpenListError 携带失败session的上游错误。
       */
      async (_instance, _id, _index, body) => {
        if (Buffer.isBuffer(body)) throw new Error('Expected streamed body');
        const iterator = body[Symbol.asyncIterator]();
        await iterator.next();
        pending = iterator.next().then(
          /** 记录流已正常退出。
           * @param 不适用。
           * @returns 不适用。
           * @throws 不适用。
           */
          () => {
            bodySettled = true;
          },
          /** 记录中止已传到生成器，避免悬空拒绝。
           * @param 不适用。
           * @returns 不适用。
           * @throws 不适用。
           */
          () => {
            bodySettled = true;
          },
        );
        throw new OpenListError(
          'OPENLIST_ERROR',
          'Session failed',
          200,
          500,
          0,
          {
            upload_id: transfer.session?.uploadId,
            attempt: 0,
            state: 'failed_permanent',
            chunk_size: 1048576,
            total_chunks: 1,
            received: [],
            received_bytes: 0,
            frontier: 0,
          },
        );
      },
    );
    try {
      await expect(
        uploadChunk(
          transfer,
          0,
          [...transfer.blocks],
          relay.spool,
          f.app.get(RelayResources),
          multipart,
          stop.signal,
        ),
      ).rejects.toMatchObject({ code: 'OPENLIST_ERROR', unknown: false });
      expect(bodySettled).toBe(true);
      expect(transfer.transferredBytes).toBe(1);
    } finally {
      stop.abort();
      await pending;
      await relay.abort(transfer, AbortSignal.timeout(1000));
      await relay.dispose(transfer);
    }
  });
  /** 超长服务端退避不能溢出Node定时器后形成紧密重试。
   * @param 不适用。
   * @returns 取消前没有提前重传。
   * @throws Error 断言失败。
   */
  it('keeps a huge Retry-After cancellable without immediately resending', async () => {
    let attempts = 0;
    f.fault =
      /** 分片受理后返回真实HTTP流控及超出Node定时器上限的退避。
       * @param call 当前请求。
       * @param response 原响应。
       * @returns 429或原响应。
       * @throws 不适用。
       */
      (call, response) => {
        if (call.url.endsWith('/chunk')) {
          attempts++;
          return {
            status: 429,
            headers: { 'retry-after': '4294967296' },
            body: '',
          };
        }
        return response;
      };
    const accepted = f
      .runs()
      .trigger(f.job().id, { dryRun: false, confirmDeletes: false });
    await vi.waitFor(
      /** 等待第一个真实上传请求被服务器记录。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 请求尚未到达，由waitFor重试。
       */
      () => expect(attempts).toBeGreaterThan(0),
    );
    await delay(50);
    f.runs().cancel(accepted.id);
    expect((await terminal(f, accepted.id)).status).toBe('cancelled');
    expect(attempts).toBe(1);
  });
});
