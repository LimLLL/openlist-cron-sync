// 恢复已提交副作用，不重放pending计划；任务并行观察，relay只收尾。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { operations, operationAttempts } from '../database/operation-schema.js';
import type { ExecutionRecord } from '../database/operation-schema.js';
import { runTargets } from '../database/run-schema.js';
import type { RunRecord } from '../database/run-schema.js';
import { KeysService } from '../security/keys.service.js';
import { OpenListClient } from '../openlist/client.service.js';
import { OpenListMultipart } from '../openlist/multipart.service.js';
import { aborted } from '../common/abort.js';
import { OpenListError } from '../openlist/errors.js';
import { Readiness } from '../coordination/readiness.js';
import { ExecutionContext, runSecrets } from './execution-context.js';
import { OperationStore } from './operation-store.js';
import { Mutations } from './mutations.js';
import { CopyTracker } from './copy-tracker.js';
import { executionColumns } from '../database/operation-records.js';
/** 已提交动作恢复服务。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class ExecutionRecovery {
  private readonly logger = new Logger(ExecutionRecovery.name);
  /** 保存恢复依赖，不反向调用Runs。
   * @param database 共享数据库。
   * @param keys 路径秘密解密。
   * @param client 文件观察。
   * @param multipart session收尾。
   * @param readiness 关闭状态。
   * @param copies task跟踪。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(KeysService) private readonly keys: KeysService,
    @Inject(OpenListClient) private readonly client: OpenListClient,
    @Inject(OpenListMultipart) private readonly multipart: OpenListMultipart,
    @Inject(Readiness) private readonly readiness: Readiness,
    @Inject(CopyTracker) private readonly copies: CopyTracker,
  ) {}
  /** 启动全部已知task的独立跟踪；非task按批收尾。
   * @param run recovering Run。
   * @param shutdown 进程关闭信号。
   * @returns 全部本地恢复工作结束。
   * @throws Error 数据库或实现错误。
   */
  async recover(run: RunRecord, shutdown: AbortSignal): Promise<void> {
    const stop = new AbortController();
    const signal = AbortSignal.any([shutdown, stop.signal]);
    const context = new ExecutionContext(
      this.database.db,
      this.client,
      run,
      runSecrets(this.keys, run),
      signal,
      true,
      signal,
      /** 判断进程停止，恢复期限不等同于SIGTERM。
       * @param 不适用。
       * @returns 是否关闭。
       * @throws 不适用。
       */
      () => this.readiness.stopping,
    );
    const store = new OperationStore(context.db, run);
    const work: Promise<unknown>[] = [];
    let after = 0;
    try {
      for (;;) {
        const batch = context.db
          .select(executionColumns)
          .from(operations)
          .innerJoin(
            operationAttempts,
            eq(operationAttempts.operationId, operations.id),
          )
          .where(
            and(
              eq(operations.runId, run.id),
              gt(operations.seq, after),
              inArray(operationAttempts.status, [
                'submitting',
                'submitted',
                'running',
              ]),
            ),
          )
          .orderBy(asc(operations.seq))
          .limit(128)
          .all();
        if (!batch.length) break;
        for (const op of batch) {
          after = op.seq;
          if (op.openlistTaskId)
            work.push(
              this.copies.track(context, op, true).catch(
                /** 立即停止恢复的其它本地工作并保留失败。
                 * @param error 本地错误。
                 * @returns 不适用。
                 * @throws 不适用。
                 */
                (error: unknown) => {
                  stop.abort(error);
                },
              ),
            );
        }
      }
      const deadline = AbortSignal.any([
        signal,
        AbortSignal.timeout(
          Math.max(0, (run.recoveryDeadlineAt ?? Date.now()) - Date.now()),
        ),
      ]);
      const local = new ExecutionContext(
        context.db,
        this.client,
        run,
        context.secrets,
        deadline,
        true,
        deadline,
        /** 判断进程停止，恢复期限不等同于SIGTERM。
         * @param 不适用。
         * @returns 是否关闭。
         * @throws 不适用。
         */
        () => this.readiness.stopping,
      );
      const mutations = new Mutations(local, store);
      after = 0;
      for (;;) {
        const batch = context.db
          .select(executionColumns)
          .from(operations)
          .innerJoin(
            operationAttempts,
            eq(operationAttempts.operationId, operations.id),
          )
          .where(
            and(
              eq(operations.runId, run.id),
              gt(operations.seq, after),
              isNull(operationAttempts.openlistTaskId),
              inArray(operationAttempts.status, [
                'submitting',
                'submitted',
                'running',
              ]),
            ),
          )
          .orderBy(asc(operations.seq))
          .limit(128)
          .all();
        if (!batch.length || this.readiness.stopping) break;
        for (const op of batch) {
          after = op.seq;
          await this.local(local, store, mutations, op, deadline);
        }
      }
      await Promise.all(work);
      if (stop.signal.aborted) throw stop.signal.reason;
    } catch (error) {
      stop.abort(error);
      if (!(
        this.readiness.stopping &&
        (error instanceof OpenListError || aborted(error, shutdown))
      ))
        throw error;
    } finally {
      await Promise.allSettled(work);
    }
  }
  /** 按原relay/delete崩溃窗口收尾一个非task动作。
   * @param context 原运行读取能力。
   * @param store 操作存取。
   * @param mutations 删除确认。
   * @param op 未决动作。
   * @param signal 恢复期限。
   * @returns 收尾完成。
   * @throws Error 数据库失败。
   */
  private async local(
    context: ExecutionContext,
    store: OperationStore,
    mutations: Mutations,
    op: ExecutionRecord,
    signal: AbortSignal,
  ): Promise<void> {
    const target = context.db
      .select()
      .from(runTargets)
      .where(eq(runTargets.id, op.runTargetId))
      .get();
    if (!target) throw new Error('Recovery target missing');
    if (op.status === 'running' && op.action === 'delete') {
      await mutations.confirm(target, op);
      return;
    }
    if (
      op.multipartUploadId &&
      op.multipartState === 'completed' &&
      op.sourceStreamCompletedAt !== null
    ) {
      store.end(op.id, { status: 'succeeded' });
      return;
    }
    if (op.multipartUploadId && !signal.aborted) {
      try {
        const instance = context.instance(op.targetInstanceId);
        const status = await this.multipart.status(
          instance,
          op.multipartUploadId,
          context.request(),
        );
        if (
          status.state === 'completed' &&
          status.uploadId === op.multipartUploadId &&
          status.attempt === op.multipartAttempt &&
          status.chunkSize === op.multipartChunkSize &&
          op.expectedSourceSize !== null &&
          status.totalChunks ===
            Math.ceil(op.expectedSourceSize / status.chunkSize) &&
          op.sourceStreamCompletedAt !== null
        ) {
          store.end(op.id, { status: 'succeeded' });
          return;
        }
        await this.multipart.abort(
          instance,
          op.multipartUploadId,
          context.request(),
        );
      } catch (error) {
        if (!(error instanceof OpenListError) && !aborted(error, signal))
          throw error;
        this.logger.warn('Recovery session unavailable', {
          attemptId: op.id,
          errorCode:
            error instanceof OpenListError ? error.code : 'PROCESS_RESTART',
        });
      }
    }
    if (this.readiness.stopping) return;
    store.end(op.id, {
      status: 'unknown',
      code: 'OPENLIST_ERROR',
      message: 'Process restarted without completion evidence',
    });
  }
}
