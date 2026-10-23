// 流式发送原spool数据；分片重传只使用同session的已确认事实。
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { RelayResources } from '../coordination/relay-resources.js';
import { OpenListError } from '../openlist/errors.js';
import { multipartSnapshot } from '../openlist/multipart.service.js';
import type {
  OpenListMultipart,
  MultipartSnapshot,
} from '../openlist/multipart.service.js';
import type { Block, Spool } from './spool.js';
import type { PreparedTransfer } from './relay-types.js';
import { RelayError } from './errors.js';
import { backoffMs } from '../common/backoff.js';

/** 验证同一session和attempt，返回可继续的事实。
 * @param expected init持久化时的快照。
 * @param value 后续响应。
 * @returns 同一个session快照。
 * @throws RelayError session失败或身份/attempt改变。
 */
export function checkSession(
  expected: MultipartSnapshot,
  value: MultipartSnapshot,
): MultipartSnapshot {
  if (
    value.uploadId !== expected.uploadId ||
    value.attempt !== expected.attempt ||
    value.chunkSize !== expected.chunkSize ||
    value.totalChunks !== expected.totalChunks
  )
    throw new RelayError(
      'UPSTREAM_PROTOCOL_ERROR',
      'Multipart identity or attempt changed',
      false,
      true,
    );
  if (value.state === 'failed_retriable' || value.state === 'failed_permanent')
    throw new RelayError(
      'OPENLIST_ERROR',
      'Multipart session failed',
      value.state === 'failed_retriable',
    );
  if (value.state === 'aborted')
    throw new RelayError(
      'OPENLIST_ERROR',
      'Multipart session aborted without completion evidence',
      false,
      true,
    );
  return value;
}
/** 分片发送及同session恢复，等待complete不经过此worker。
 * @param transfer 已持久化session的传输。
 * @param index chunk序号。
 * @param blocks 完整且尚未删除的原始块。
 * @param spool 当前进程块存储。
 * @param resources 共享配额。
 * @param multipart 协议客户端。
 * @param signal 文件级停止信号。
 * @returns chunk已确认接收。
 * @throws RelayError 无法证明接收或session失败；Error 取消或本地错误。
 */
export async function uploadChunk(
  transfer: PreparedTransfer,
  index: number,
  blocks: readonly Block[],
  spool: Spool,
  resources: RelayResources,
  multipart: OpenListMultipart,
  signal: AbortSignal,
): Promise<void> {
  const session = transfer.session;
  if (!session) throw new Error('Chunk before persisted session');
  const { settings, target, jobId, bandwidth } = transfer.input;
  const bucket = resources.bucket(jobId, bandwidth);
  const size = blocks.reduce(
    /** 累计本chunk完整payload长度用于Content-Length。
     * @param sum 已有累计字节。
     * @param block 当前已发布块。
     * @returns 累计字节数。
     * @throws 不适用。
     */
    (sum, block) => sum + block.size,
    0,
  );
  let failures = 0;
  for (;;) {
    signal.throwIfAborted();
    let flow = false;
    let original: unknown;
    try {
      const bodyStop = new AbortController();
      const bodySignal = AbortSignal.any([signal, bodyStop.signal]);
      /** 每次重传都重新读取同一份spool，不复用已消费的网络流。
       * @param 不适用。
       * @returns 有界且已限速的payload片段。
       * @throws RelayError spool读取失败；Error 取消。
       */
      async function* payload(): AsyncGenerator<Buffer> {
        for (const block of blocks) {
          const data = await spool.read(block);
          for (let offset = 0; offset < data.length;) {
            const count = await bucket.take(data.length - offset, bodySignal);
            bodySignal.throwIfAborted();
            transfer.transferredBytes += count;
            if (!Number.isSafeInteger(transfer.transferredBytes))
              throw new RelayError('RESOURCE_LIMIT');
            yield data.subarray(offset, offset + count);
            offset += count;
          }
        }
      }
      const body = Readable.from(payload());
      let localFailure: unknown;
      body.on(
        'error',
        /** 保存上传body的本地失败，避免被HTTP错误包装丢失。
         * @param error 原始错误，仅转换为受控结果或安全特征。
         * @returns 不适用。
         * @throws 不适用。
         */
        (error: Error) => {
          localFailure = error;
        },
      );
      try {
        const result = checkSession(
          session,
          await multipart.chunk(
            target,
            session.uploadId,
            index,
            body,
            signal,
            { settings },
            size,
          ),
        );
        if (
          result.received.some(
            /** 检查chunk编号是否落在服务端已接收闭区间。
             * @param input 服务端已接收闭区间的起止编号。
             * @returns 是否已确认接收。
             * @throws 不适用。
             */
            ([first, last]) => first <= index && index <= last,
          ) ||
          result.state === 'completed'
        )
          return;
      } catch (error) {
        if (localFailure instanceof RelayError) throw localFailure;
        throw error;
      } finally {
        // 上游可提前返回409/429；停止并等待限速中的生成器，之后不再读取块或累计字节。
        const closed = finished(body, { cleanup: true });
        bodyStop.abort();
        body.destroy();
        await closed.catch(
          /** 已捕获的body错误保留原请求分类，主动destroy允许提前关闭；其它收尾失败向上传播。
           * @param error 流结束时的错误。
           * @returns 已知关闭原因时不适用。
           * @throws Error 非预期收尾失败。
           */
          (error: unknown) => {
            if (
              error !== localFailure &&
              !(
                error instanceof Error &&
                'code' in error &&
                error.code === 'ERR_STREAM_PREMATURE_CLOSE'
              )
            )
              throw error;
          },
        );
      }
    } catch (error) {
      if (!(error instanceof OpenListError)) throw error;
      original = error;
      flow =
        error.upstreamCode === 429 ||
        error.upstreamCode === 409 ||
        error.httpStatus === 429 ||
        error.httpStatus === 409;
      if (error.data !== undefined && error.data !== null) {
        const state = checkSession(session, multipartSnapshot(error.data));
        if (
          state.received.some(
            /** 检查chunk编号是否落在服务端已接收闭区间。
             * @param input 服务端已接收闭区间的起止编号。
             * @returns 是否已确认接收。
             * @throws 不适用。
             */
            ([first, last]) => first <= index && index <= last,
          )
        )
          return;
      }
    }
    if (!flow) {
      try {
        const status = checkSession(
          session,
          await multipart.status(target, session.uploadId, {
            signal,
            settings,
          }),
        );
        if (
          status.received.some(
            /** 检查chunk编号是否落在服务端已接收闭区间。
             * @param input 服务端已接收闭区间的起止编号。
             * @returns 是否已确认接收。
             * @throws 不适用。
             */
            ([first, last]) => first <= index && index <= last,
          ) ||
          status.state === 'completed'
        )
          return;
      } catch (error) {
        if (error instanceof RelayError) throw error;
        if (!(error instanceof OpenListError)) throw error;
        throw new RelayError(
          error.code,
          'Multipart chunk outcome unknown',
          false,
          true,
        );
      }
      if (++failures >= settings.retryMaxAttempts)
        throw new RelayError(
          'OPENLIST_ERROR',
          'Multipart chunk retries exhausted',
          true,
        );
    }
    const retryAfter =
      original instanceof OpenListError ? original.retryAfterMs : 0;
    let waitMs = Math.max(
      retryAfter,
      flow ? 250 + Math.random() * 1750 : backoffMs(settings, failures),
    );
    // Node超长定时器会溢出为1ms；分段等待保持Retry-After语义，总期限仍可中止。
    while (waitMs > 0) {
      const part = Math.min(waitMs, 2147483647);
      await delay(part, undefined, { signal });
      waitMs -= part;
    }
  }
}
