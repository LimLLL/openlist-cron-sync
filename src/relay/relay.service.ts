// 连接下载和上传worker；所有远端提交都经过Sync提供的持久化检查点。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OpenListClient } from '../openlist/client.service.js';
import {
  OpenListMultipart,
  multipartSnapshot,
} from '../openlist/multipart.service.js';
import type { MultipartSnapshot } from '../openlist/multipart.service.js';
import { OpenListError } from '../openlist/errors.js';
import { RelayResources } from '../coordination/relay-resources.js';
import { Download } from './download.js';
import { BLOCK_BYTES, Spool } from './spool.js';
import type { Block } from './spool.js';
import { RelayError } from './errors.js';
import { uploadChunk, checkSession } from './chunk-upload.js';
import type {
  RelayInput,
  PreparedTransfer,
  RelayCheckpoints,
} from './relay-types.js';
import { setTimeout as delay } from 'node:timers/promises';
import { backoffMs } from '../common/backoff.js';

/** 具体relay流水线，不拥有Run或Operation状态机。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);
  /** 保存共享依赖。
   * @param client 源文件读取。
   * @param multipart 目标协议。
   * @param resources Job/Target资源配额。
   * @param spool 本地块存储。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(OpenListClient) private readonly client: OpenListClient,
    @Inject(OpenListMultipart) private readonly multipart: OpenListMultipart,
    @Inject(RelayResources) private readonly resources: RelayResources,
    @Inject(Spool) readonly spool: Spool,
  ) {}
  /** 取得名额并把源首块写盘；失败前没有目标变更。
   * @param input 固定文件尝试。
   * @param progress 源准备失败时保存已发生传输的字节，持久化失败向上传播。
   * @returns 证明源可读的句柄。
   * @throws RelayError 源或spool失败；Error 取消或本地错误。
   */
  async prepare(
    input: RelayInput,
    progress: (downloaded: number, transferred: number) => void,
  ): Promise<PreparedTransfer> {
    let releaseFile: (() => void) | undefined;
    const download = new Download(input, this.client);
    const transfer: PreparedTransfer = {
      input,
      download,
      first: Buffer.alloc(0),
      blocks: new Set(),
      transferredBytes: 0,
      sourceComplete: false,
      completing: false,
      /** 一起归还Job源文件和Target文件配额。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      release: () => {
        releaseFile?.();
      },
    };
    try {
      releaseFile = await this.resources.relayFile(
        input.jobId,
        input.targetResourceId,
        input.sourceDownloadConcurrency,
        input.targetConcurrentFiles,
        input.signal,
      );
      const size = Math.min(input.size, BLOCK_BYTES);
      const reservation = await this.spool.reserve(
        size,
        size,
        input.signal,
        false,
      );
      try {
        // 先预留首块再打开GET，等待spool空间时不占住源连接。
        await download.open();
        transfer.first = await download.take(size || 1);
        if (transfer.first.length !== size)
          throw new RelayError('SIZE_MISMATCH');
        if (size)
          transfer.blocks.add(
            await this.spool.publish(
              input.operationId,
              0,
              transfer.first,
              reservation,
            ),
          );
        if (input.size <= BLOCK_BYTES && (await download.take(1)).length)
          throw new RelayError('SIZE_MISMATCH');
      } finally {
        this.spool.unreserve(reservation);
      }
      return transfer;
    } catch (error) {
      try {
        progress(download.downloadedBytes, transfer.transferredBytes);
      } finally {
        await this.dispose(transfer);
      }
      throw error;
    }
  }
  /** 提交已准备文件，先等待session/EOF落库再开放chunk。
   * @param transfer 当前尝试句柄。
   * @param checkpoints Sync持久化边界。
   * @returns 完成；失败由Sync决定最终状态及重试。
   * @throws RelayError 协议或传输失败；OpenListError init/put失败；Error 持久化失败。
   */
  async upload(
    transfer: PreparedTransfer,
    checkpoints: RelayCheckpoints,
  ): Promise<void> {
    const { input } = transfer;
    const { target, file, settings, signal } = input;
    if (input.size === 0) {
      checkpoints.eof();
      transfer.sourceComplete = true;
      // 提交闸门仍由submitting检查停止信号；已派发的put在收尾期限内等待响应，以免把已完成写入记为unknown。
      const tasks = await this.multipart.putEmpty(target, file, {
        signal: input.control ?? signal,
        settings,
        cleanup: input.control !== undefined,
        beforeDispatch: checkpoints.submitting,
      });
      if (tasks.length)
        throw new RelayError(
          'UPSTREAM_PROTOCOL_ERROR',
          'Unexpected task in synchronous empty put',
          false,
          true,
        );
      return;
    }
    const session = await this.multipart.init(target, file, input.size, {
      signal,
      settings,
      beforeDispatch: checkpoints.submitting,
    });
    checkpoints.session(session);
    transfer.session = session;
    if (
      session.chunkSize < BLOCK_BYTES ||
      session.chunkSize % BLOCK_BYTES ||
      session.totalChunks !== Math.ceil(input.size / session.chunkSize)
    )
      throw new RelayError(
        'UPSTREAM_PROTOCOL_ERROR',
        'Invalid multipart chunk layout',
        false,
        true,
      );
    checkSession(session, session);
    // 首块已经成功写盘证明源可读；释放磁盘后从有界准备缓冲重新发布，避免多个预读首块锁死完整chunk预留。
    await this.releaseBlocks(transfer, [...transfer.blocks]);
    const stop = new AbortController();
    const workSignal = AbortSignal.any([signal, stop.signal]);
    const heartbeatStop = new AbortController();
    let failure: unknown;
    const heartbeat = this.heartbeat(
      transfer,
      AbortSignal.any([signal, heartbeatStop.signal]),
    ).catch(
      /** 保留首个流水线错误并停止后续数据派发。
       * @param error 原始错误，仅转换为受控结果或安全特征。
       * @returns 不适用。
       * @throws 不适用。
       */
      (error: unknown) => {
        failure ??= error;
        if (!transfer.completing) stop.abort(error);
      },
    );
    const pending = new Set<Promise<void>>();
    try {
      for (let index = 0; index < session.totalChunks; index++) {
        if (pending.size >= input.targetChunkConcurrency)
          await Promise.race(pending);
        if (failure) throw failure;
        workSignal.throwIfAborted();
        const size = Math.min(
          session.chunkSize,
          input.size - index * session.chunkSize,
        );
        const reservation = await this.spool.reserve(
          size,
          size,
          workSignal,
          true,
        );
        const blocks: Block[] = [];
        try {
          for (let offset = 0; offset < size; offset += BLOCK_BYTES) {
            const count = Math.min(BLOCK_BYTES, size - offset);
            const data =
              index === 0 && offset === 0
                ? transfer.first
                : await transfer.download.take(count);
            if (data.length !== count) throw new RelayError('SIZE_MISMATCH');
            const block = await this.spool.publish(
              input.operationId,
              (index * session.chunkSize + offset) / BLOCK_BYTES,
              data,
              reservation,
            );
            blocks.push(block);
            transfer.blocks.add(block);
          }
          if (index === session.totalChunks - 1) {
            if ((await transfer.download.take(1)).length)
              throw new RelayError('SIZE_MISMATCH');
            checkpoints.eof();
            transfer.sourceComplete = true;
          }
        } finally {
          this.spool.unreserve(reservation);
        }
        const sending = uploadChunk(
          transfer,
          index,
          blocks,
          this.spool,
          this.resources,
          this.multipart,
          workSignal,
        )
          .then(
            /** chunk确认后释放其原始块并移出当前传输责任集合。
             * @param 不适用。
             * @returns 块释放完成。
             * @throws RelayError spool清理失败。
             */
            async () => {
              await this.releaseBlocks(transfer, blocks);
            },
          )
          .catch(
            /** 保留首个流水线错误并停止后续数据派发。
             * @param error 原始错误，仅转换为受控结果或安全特征。
             * @returns 不适用。
             * @throws 不适用。
             */
            (error: unknown) => {
              failure ??= error;
              stop.abort(error);
            },
          );
        const tracked = sending.finally(
          /** 上传结束后从有界在途集合移除本次请求。
           * @param 不适用。
           * @returns 是否移除了请求。
           * @throws 不适用。
           */
          () => pending.delete(tracked),
        );
        pending.add(tracked);
      }
      await Promise.all(pending);
      if (failure) throw failure;
      transfer.completing = true;
      transfer.session = await this.complete(transfer, signal);
      checkpoints.session(transfer.session);
    } catch (error) {
      stop.abort(error);
      await Promise.all(pending);
      throw failure ?? error;
    } finally {
      heartbeatStop.abort();
      await heartbeat;
    }
  }
  /** complete丢响应时仅凭同session可靠completed证据收敛。
   * @param transfer 已完成EOF和chunk的尝试。
   * @param signal 文件总期限。
   * @returns 上传完成。
   * @throws RelayError 无法确定完成或session失败；Error 本地错误。
   */
  private async complete(
    transfer: PreparedTransfer,
    signal: AbortSignal,
  ): Promise<MultipartSnapshot> {
    const session = transfer.session;
    if (!session || !transfer.sourceComplete)
      throw new Error('Completion before source EOF');
    const { target, settings } = transfer.input;
    if (session.state === 'completed') return session;
    for (let attempt = 1; attempt <= settings.retryMaxAttempts; attempt++) {
      try {
        const result = checkSession(
          session,
          await this.multipart.complete(target, session.uploadId, signal, {
            settings,
          }),
        );
        if (result.state === 'completed') return result;
      } catch (error) {
        if (transfer.session?.state === 'completed') return transfer.session;
        if (!(error instanceof OpenListError)) throw error;
        if (error.data !== undefined && error.data !== null) {
          const result = checkSession(session, multipartSnapshot(error.data));
          if (result.state === 'completed') return result;
        }
        try {
          const status = checkSession(
            session,
            await this.multipart.status(target, session.uploadId, {
              signal,
              settings,
            }),
          );
          if (status.state === 'completed') return status;
        } catch (cause) {
          if (cause instanceof RelayError) throw cause;
          if (!(cause instanceof OpenListError)) throw cause;
          throw new RelayError(
            cause.code,
            'Multipart completion outcome unknown',
            false,
            true,
          );
        }
      }
      await delay(backoffMs(settings, attempt), undefined, { signal });
    }
    throw new RelayError(
      'OPENLIST_ERROR',
      'Multipart completion outcome unknown',
      false,
      true,
    );
  }
  /** 活跃session定时心跳；退出后停止，不在chunk热路径打印。
   * @param transfer 已持久化session。
   * @param signal 心跳生命周期。
   * @returns 心跳停止。
   * @throws Error 非上游本地错误。
   */
  private async heartbeat(
    transfer: PreparedTransfer,
    signal: AbortSignal,
  ): Promise<void> {
    const session = transfer.session;
    if (!session) return;
    while (!signal.aborted) {
      try {
        await delay(60000, undefined, { signal });
        transfer.session = checkSession(
          session,
          await this.multipart.status(transfer.input.target, session.uploadId, {
            signal,
            settings: transfer.input.settings,
          }),
        );
      } catch (error) {
        if (signal.aborted) return;
        if (!(error instanceof OpenListError)) throw error;
        if (error.upstreamCode === 404)
          throw new RelayError(
            'OPENLIST_ERROR',
            'Multipart session disappeared',
            false,
            true,
          );
        this.logger.warn('Relay heartbeat unavailable', {
          operationId: transfer.input.operationId,
          errorCode: error.code,
        });
      }
    }
  }
  /** 停止失败session，取消信号独立于已经停止的数据通道。
   * @param transfer 已知上传句柄。
   * @param signal 清理宽限。
   * @returns abort请求已完成；不承诺远端驱动已停止。
   * @throws OpenListError abort失败。
   */
  async abort(transfer: PreparedTransfer, signal: AbortSignal): Promise<void> {
    if (transfer.session)
      await this.multipart.abort(
        transfer.input.target,
        transfer.session.uploadId,
        { signal, settings: transfer.input.settings, cleanup: true },
      );
  }
  /** 所有发送者退出后释放本地数据、连接和名额。
   * @param transfer 当前尝试。
   * @returns 资源释放完成。
   * @throws Error 本地清理失败。
   */
  async dispose(transfer: PreparedTransfer): Promise<void> {
    try {
      await transfer.download.close();
      await this.releaseBlocks(transfer, [...transfer.blocks]);
      await this.spool.finish(transfer.input.operationId);
    } finally {
      transfer.release();
    }
  }
  /** 每块删除成功后立即解除责任，后续块失败时收尾不能重复扣减已释放空间。
   * @param transfer 持有当前块责任的传输。
   * @param blocks 已无读取者的待释放块。
   * @returns 本批块均已释放。
   * @throws RelayError 文件系统清理失败，未释放块仍保留在责任集合。
   */
  private async releaseBlocks(
    transfer: PreparedTransfer,
    blocks: readonly Block[],
  ): Promise<void> {
    for (const block of blocks) {
      await this.spool.release([block]);
      transfer.blocks.delete(block);
    }
  }
}
