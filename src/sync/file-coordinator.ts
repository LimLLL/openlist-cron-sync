// 协调源准备、替换/重试清理和relay提交；delete不能脱离此工作流派发。
import { Logger } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import type { OperationRecord } from '../database/operation-schema.js';
import type { RunTargetRecord } from '../database/run-schema.js';
import type { RelayService } from '../relay/relay.service.js';
import type { PreparedTransfer } from '../relay/relay-types.js';
import { RelayError } from '../relay/errors.js';
import { OpenListError } from '../openlist/errors.js';
import { splitPath } from './execution-context.js';
import type { ExecutionContext } from './execution-context.js';
import type { OperationStore } from './operation-store.js';
import { RelayOutcome } from './relay-outcome.js';
import { CopyFile } from './copy-file.js';
import type { CopyTracker } from './copy-tracker.js';
import { Mutations, observeError, rejected } from './mutations.js';

/** 一个Run的具体文件执行协调器。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class FileCoordinator {
  private readonly logger = new Logger(FileCoordinator.name);
  /** 保存当前Run协作对象。
   * @param context 固定身份与观察。
   * @param store 原子操作存取。
   * @param relay 传输实现。
   * @param mutations 删除执行与确认。
   * @param failRun 持久化失败时立即停止整个Run的回调。
   * @param copies server_copy生命周期。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    private readonly context: ExecutionContext,
    private readonly store: OperationStore,
    private readonly relay: RelayService,
    private readonly mutations: Mutations,
    private readonly failRun: (error: unknown) => void,
    private readonly copies: CopyTracker,
  ) {}
  /** 执行一个逻辑create及其有界重试，每次尝试独立留痕。
   * @param target 当前目标。
   * @param initial pending create。
   * @param admitted 首次源配额和首块空间就绪时通知派发器；重试沿用同一协调器。
   * @returns 当前逻辑动作已收敛。
   * @throws Error 取消或不可恢复本地错误。
   */
  async execute(
    target: RunTargetRecord,
    initial: OperationRecord,
    admitted?: () => void,
  ): Promise<void> {
    const relayOutcome = new RelayOutcome(this.context, this.relay);
    const copy = new CopyFile(this.context, this.store, this.copies);
    const serverCopy = initial.method === 'server_copy';
    let op = initial;
    for (;;) {
      this.context.signal.throwIfAborted();
      if (op.nextAttemptAt)
        await delay(Math.max(0, op.nextAttemptAt - Date.now()), undefined, {
          signal: this.context.signal,
        });
      const dependencies = this.store.dependencies(op.id);
      if (
        dependencies.some(
          /** 检查create的父目录依赖，delete由文件工作流单独处理。
           * @param dep 当前create依赖。
           * @returns 是否存在未成功的父目录依赖。
           * @throws 不适用。
           */
          (dep) => dep.action !== 'delete' && dep.status !== 'succeeded',
        )
      ) {
        this.store.end(op.id, { status: 'skipped', code: 'DEPENDENCY_FAILED' });
        this.settleDeletes(op);
        return;
      }
      let transfer: PreparedTransfer | undefined;
      let retryable = false;
      let progressTimer: ReturnType<typeof setInterval> | undefined;
      let persistenceFailure: unknown;
      const localStop = new AbortController();
      const settings = this.context.run.config.settings;
      // 文件级硬期限（持久化失败或relay总期限），与Run停止信号分开传给删除执行器。
      const deadline = AbortSignal.any([
        localStop.signal,
        ...(serverCopy
          ? []
          : [AbortSignal.timeout(settings.relayTotalTimeoutSeconds * 1000)]),
      ]);
      const signal = AbortSignal.any([this.context.signal, deadline]);
      try {
        if (
          !op.sourcePath ||
          !op.sourceInstanceId ||
          op.expectedSourceSize === null
        )
          throw new Error('Incomplete create plan');
        if (serverCopy)
          await this.copies.resources.reserve(
            target.id,
            target.config.target.concurrentFiles,
            op.id,
            signal,
          );
        else {
          transfer = await this.relay.prepare(
            {
              operationId: op.id,
              jobId: this.context.run.jobId,
              sourceDownloadConcurrency:
                this.context.run.config.job.sourceDownloadConcurrency,
              bandwidth: this.context.run.config.job.relayBandwidthLimit,
              instance: this.context.instance(op.sourceInstanceId),
              target: this.context.instance(op.targetInstanceId),
              targetResourceId: target.config.target.id,
              targetConcurrentFiles: target.config.target.concurrentFiles,
              targetChunkConcurrency: target.config.target.chunkConcurrency,
              ...splitPath(op.sourcePath),
              file: {
                ...splitPath(op.targetPath),
                modified: op.expectedSourceModified,
              },
              size: op.expectedSourceSize,
              password: this.context.secrets.sourcePassword ?? '',
              settings,
              signal,
              control: AbortSignal.any([this.context.hard, deadline]),
            },
            /** 保存当前尝试的累计下载和上传字节。
             * @param downloaded 累计下载字节。
             * @param transferred 累计上传payload字节。
             * @returns 不适用。
             * @throws Error 数据库失败。
             */
            (downloaded, transferred) =>
              this.store.bytes(op.id, downloaded, transferred),
            admitted,
          );
          const progress = transfer;
          progressTimer = setInterval(
            /** 定期保存累计传输字节；持久化失败立即停止整个Run。
             * @param 不适用。
             * @returns 不适用。
             * @throws 不适用；错误由停止信号交给协调器。
             */
            () => {
              try {
                this.store.bytes(
                  op.id,
                  progress.download.downloadedBytes,
                  progress.transferredBytes,
                );
              } catch (error) {
                persistenceFailure = error;
                localStop.abort(error);
                this.failRun(error);
              }
            },
            5000,
          );
        }
        /** 每次删除尝试重新验证source元数据。
         * @param 不适用。
         * @returns 准备完成。
         * @throws OpenListError 源不可读或变化。
         */
        const beforeDelete = serverCopy
          ? copy.source.bind(copy, target, op)
          : undefined;
        for (const dep of dependencies) {
          if (dep.action !== 'delete') continue;
          const latest = this.store.latest(dep);
          const result =
            latest.status === 'pending'
              ? await this.mutations.execute(
                  target,
                  latest,
                  deadline,
                  beforeDelete,
                )
              : latest;
          if (
            result.status !== 'succeeded' &&
            result.errorCode !== 'PRECONDITION_ALREADY_ABSENT'
          ) {
            this.store.end(op.id, {
              status: 'skipped',
              code: 'DEPENDENCY_FAILED',
            });
            return;
          }
        }
        if (
          op.attemptNo > 1 &&
          !(await this.cleanRetry(target, op, deadline, beforeDelete))
        )
          return;
        if (serverCopy) {
          const result = await copy.submit(op);
          retryable = result.status === 'failed';
        } else {
          if (!transfer) throw new Error('Relay preparation missing');
          const uploading = transfer;
          await this.relay.upload(uploading, {
            /** 在实际派发前提交submitting事务并复查停止信号。
             * @param 不适用。
             * @returns 不适用。
             * @throws Error 取消或持久化失败。
             */
            submitting: () => this.store.submitting(op.id, signal),
            /** 在chunk开放前持久化已验证session快照。
             * @param session 已验证的上游session快照。
             * @returns 不适用。
             * @throws Error 持久化失败。
             */
            session: (session) => this.store.session(op.id, session),
            /** 在最后chunk开放前持久化完整源EOF。
             * @param 不适用。
             * @returns 不适用。
             * @throws Error 持久化失败。
             */
            eof: () => this.store.eof(op.id),
            /** payload已发送完，停止在长complete期间重复写入不变的字节数。
             * @param 不适用。
             * @returns 不适用。
             * @throws Error 进度持久化失败，向上传播停止Run。
             */
            uploaded: () => {
              if (progressTimer) clearInterval(progressTimer);
              progressTimer = undefined;
              this.store.bytes(
                op.id,
                uploading.download.downloadedBytes,
                uploading.transferredBytes,
              );
            },
          });
          this.store.end(op.id, { status: 'succeeded' });
        }
      } catch (error) {
        // 在远端abort、结果观察和spool清理之前停止源，不能让这些等待占住下载配额。
        if (transfer) await transfer.closeSource();
        if (persistenceFailure) throw persistenceFailure;
        if (serverCopy && !(error instanceof OpenListError)) throw error;
        if (
          serverCopy &&
          this.context.stopping() &&
          (!(error instanceof OpenListError) || error.upstreamCode === null)
        )
          throw error;
        const current = this.store.get(op.id);
        // 停止后仍收到的0字节put响应是明确结果，按完成分类观察，而不是直接记unknown。
        const answered =
          (serverCopy || op.expectedSourceSize === 0) &&
          error instanceof OpenListError &&
          (error.upstreamCode !== null || error.httpStatus !== null);
        if (this.context.signal.aborted && !answered) {
          if (current.status !== 'pending')
            this.store.end(op.id, {
              status: 'unknown',
              code: 'OPENLIST_ERROR',
              message: 'Run stopped with unconfirmed write',
            });
          if (transfer?.session) await relayOutcome.abort(transfer);
          throw this.context.signal.reason;
        }
        if (transfer?.session) await relayOutcome.abort(transfer);
        const outcome = serverCopy
          ? current.status === 'pending'
            ? {
                status:
                  error instanceof OpenListError &&
                  error.code === 'SOURCE_CHANGED'
                    ? ('skipped' as const)
                    : ('failed' as const),
                code:
                  error instanceof OpenListError
                    ? error.code
                    : 'INTERNAL_ERROR',
              }
            : await observeError(
                this.context,
                target,
                current,
                error as OpenListError,
              )
          : await relayOutcome.classify(
              target,
              current,
              error,
              deadline.aborted,
            );
        this.store.end(op.id, outcome);
        retryable =
          outcome.status === 'failed' &&
          (error instanceof RelayError
            ? error.retryable
            : error instanceof OpenListError &&
              (current.status === 'pending'
                ? error.code !== 'AUTH_BLOCKED' &&
                  ![400, 401, 403, 405].includes(error.upstreamCode ?? -1)
                : !rejected(error)));
        this.logger.warn('File attempt ended', {
          runId: this.context.run.id,
          operationId: op.id,
          errorCode: outcome.code,
          status: outcome.status,
        });
      } finally {
        if (serverCopy && !this.store.get(op.id).openlistTaskId)
          this.copies.resources.release(op.id);
        if (progressTimer) clearInterval(progressTimer);
        if (transfer) {
          try {
            this.store.bytes(
              op.id,
              transfer.download.downloadedBytes,
              transfer.transferredBytes,
            );
          } finally {
            await this.relay.dispose(transfer);
          }
        }
      }
      const result = this.store.get(op.id);
      const retry =
        retryable && !this.context.signal.aborted
          ? this.store.retry(result)
          : null;
      if (!retry) {
        if (result.status !== 'succeeded') this.settleDeletes(op);
        return;
      }
      op = retry;
    }
  }
  /** 原动作已明确失败后刷新残留；清理仍使用同一删除保护和剩余预算。
   * @param target 当前目标。
   * @param op 新create attempt。
   * @param deadline 文件级硬期限，传给清理删除。
   * @param beforeDelete server_copy每次删除前的source检查。
   * @returns 是否可以继续init。
   * @throws Error 本地错误或取消。
   */
  private async cleanRetry(
    target: RunTargetRecord,
    op: OperationRecord,
    deadline: AbortSignal,
    beforeDelete?: () => Promise<void>,
  ): Promise<boolean> {
    // 只有源前提失败交给外层按create结果分类；目标侧刷新失败与relay一致记PRECONDITION_UNVERIFIED。
    let sourceFailed = false;
    const checkSource = beforeDelete
      ? /** 标记源检查失败后原样抛出。
         * @param 不适用。
         * @returns 源前提成立。
         * @throws OpenListError 源不可读或变化。
         */
        async (): Promise<void> => {
          try {
            await beforeDelete();
          } catch (error) {
            sourceFailed = true;
            throw error;
          }
        }
      : undefined;
    try {
      const entry = await this.context.entry(target, op.targetPath);
      if (entry === null) return true;
      if (entry.isDir || entry.size === null) {
        this.store.end(op.id, {
          status: 'skipped',
          code: 'PRECONDITION_CHANGED',
        });
        return false;
      }
      const cleanup = this.store.cleanup(
        op,
        entry.size,
        target.deleteBudgetCount,
        target.plannedReplaceCount + target.plannedExtraCount,
      );
      if (!cleanup) {
        this.store.end(op.id, { status: 'skipped', code: 'DELETE_LIMIT' });
        return false;
      }
      const result = await this.mutations.execute(
        target,
        cleanup,
        deadline,
        checkSource,
      );
      if (
        result.status === 'succeeded' ||
        result.errorCode === 'PRECONDITION_ALREADY_ABSENT'
      )
        return true;
      this.store.end(op.id, { status: 'skipped', code: 'DEPENDENCY_FAILED' });
      return false;
    } catch (error) {
      this.context.signal.throwIfAborted();
      if (!(error instanceof OpenListError)) throw error;
      if (sourceFailed) throw error;
      this.store.end(op.id, {
        status: 'skipped',
        code: 'PRECONDITION_UNVERIFIED',
      });
      return false;
    }
  }
  /** 最终源准备失败后收尾尚未提交的伴随delete，避免悬挂pending。
   * @param op 已收敛create。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  private settleDeletes(op: OperationRecord): void {
    for (const dependency of this.store.dependencies(op.id))
      if (dependency.action === 'delete' && dependency.status === 'pending')
        this.store.end(dependency.id, {
          status: 'skipped',
          code: 'DEPENDENCY_FAILED',
        });
  }
}
