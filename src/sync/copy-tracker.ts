// 跟踪已知copy tid；执行与恢复共享取消、终态持久化及清理协议。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { operationAttempts } from '../database/operation-schema.js';
import type { ExecutionRecord } from '../database/operation-schema.js';
import { runs } from '../database/run-schema.js';
import { taskFact, updateTaskFact } from '../database/task-records.js';
import { TaskResources } from '../coordination/task-resources.js';
import { Readiness } from '../coordination/readiness.js';
import { OpenListTasks } from '../openlist/tasks.service.js';
import type { TaskInfo } from '../openlist/tasks.service.js';
import { aborted } from '../common/abort.js';
import { OpenListError } from '../openlist/errors.js';
import {
  cleanupTask,
  taskGone,
  taskStatus,
  taskTerminal,
} from '../openlist/task-protocol.js';
import type { ExecutionContext } from './execution-context.js';
import { OperationStore } from './operation-store.js';

/** 已知task的具体生命周期服务，不接受新的Run。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class CopyTracker {
  private readonly logger = new Logger(CopyTracker.name);
  /** 保存共享协议、责任及进程生命周期。
   * @param database 单写连接。
   * @param tasks task协议。
   * @param resources 共享task额度及owner。
   * @param readiness 关闭广播。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(OpenListTasks) readonly tasks: OpenListTasks,
    @Inject(TaskResources) readonly resources: TaskResources,
    @Inject(Readiness) private readonly readiness: Readiness,
  ) {}
  /** 将copy响应保存为已知任务，终态也先保留tid再统一分类。
   * @param store 当前Run的事务入口。
   * @param id 当前submitting尝试。
   * @param task 已验证单任务。
   * @returns 不适用。
   * @throws Error 状态或数据库失败。
   */
  submitted(store: OperationStore, id: string, task: TaskInfo): void {
    if (store.get(id).status !== 'submitting')
      throw new Error('Task response outside submitting');
    store.transition(id, {
      openlistTaskId: task.id,
      remoteState: task.state,
      status: 'submitted',
      updatedAt: Date.now(),
    });
  }
  /** 公平轮询一个tid；各task按固定轮询间隔独立等待，不使用扫描间隔。
   * @param context Run身份、停止及收尾期限。
   * @param initial 已持久化tid的操作。
   * @param recovering 是否使用持久恢复时钟。
   * @returns 当前结果；关机时可仍非终态。
   * @throws Error 数据库/实现错误。
   */
  async track(
    context: ExecutionContext,
    initial: ExecutionRecord,
    recovering = false,
  ): Promise<ExecutionRecord> {
    const tid = initial.openlistTaskId;
    if (!tid) throw new Error('Task ID missing');
    const release = this.resources.own(initial.targetInstanceId, tid);
    if (!release) throw new Error('Task already owned');
    const store = new OperationStore(context.db, context.run);
    const settings = context.run.config.settings;
    let protocolFailures = 0;
    try {
      if (taskTerminal(initial.remoteState))
        this.result(
          store,
          initial,
          initial.remoteState,
          !recovering && !context.signal.aborted && !this.readiness.stopping,
        );
      while (['submitted', 'running'].includes(store.get(initial.id).status)) {
        if (this.readiness.stopping) return store.get(initial.id);
        if (recovering) context.signal.throwIfAborted();
        const row = context.db
          .select()
          .from(runs)
          .where(eq(runs.id, context.run.id))
          .get();
        if (!row) throw new Error('Task Run missing');
        const anchor = recovering
          ? Math.min(
              row.recoveryDeadlineAt ?? Date.now(),
              row.cancelRequestedAt ?? Infinity,
            )
          : (row.cancelRequestedAt ?? Infinity);
        const cancelling = recovering
          ? Date.now() >= anchor
          : context.signal.aborted;
        const recoveryEnd = anchor + settings.cancelGraceSeconds * 1000;
        if (
          (recovering && Date.now() >= recoveryEnd) ||
          (!recovering && context.hard.aborted)
        ) {
          store.end(initial.id, {
            status: 'unknown',
            code: 'OPENLIST_ERROR',
            message: 'Task confirmation deadline exceeded',
          });
          break;
        }
        const until = recovering
          ? cancelling
            ? recoveryEnd
            : anchor
          : Infinity;
        const signal = AbortSignal.any([
          this.readiness.shutdown.signal,
          ...(recovering ? [context.signal] : []),
          ...(!cancelling
            ? [
                recovering
                  ? this.resources.recoveryCancelSignal(context.run.id)
                  : context.signal,
              ]
            : []),
          recovering
            ? AbortSignal.timeout(Math.max(0, until - Date.now()))
            : context.hard,
        ]);
        const request = { signal, settings, cleanup: true };
        try {
          if (
            cancelling &&
            this.resources.cancelOnce(initial.targetInstanceId, tid)
          ) {
            try {
              await this.tasks.cancel(
                context.instance(initial.targetInstanceId),
                tid,
                request,
              );
            } catch (error) {
              if (!(error instanceof OpenListError) && !aborted(error, signal))
                throw error;
              this.logger.warn('Task cancel unconfirmed', {
                attemptId: initial.id,
              });
            }
          }
          const info = await this.tasks.info(
            context.instance(initial.targetInstanceId),
            tid,
            request,
          );
          protocolFailures = 0;
          this.result(
            store,
            store.get(initial.id),
            info.state,
            !recovering && !context.signal.aborted && !this.readiness.stopping,
          );
        } catch (error) {
          if (!(error instanceof OpenListError) && !aborted(error, signal))
            throw error;
          if (this.readiness.stopping) return store.get(initial.id);
          if (!(error instanceof OpenListError)) {
            if (!aborted(error, signal)) throw error;
          } else if (taskGone(error)) {
            context.db.transaction(
              /** 丢失 tid 保留 unknown 历史，结束远程记录跟踪。
               * @param 不适用。
               * @returns 不适用。
               * @throws Error 数据库失败。
               */
              () => {
                store.end(initial.id, {
                  status: 'unknown',
                  code: 'OPENLIST_ERROR',
                  message: 'Copy task not found',
                });
                context.db
                  .update(operationAttempts)
                  .set({ remoteCleanupPending: false })
                  .where(eq(operationAttempts.id, initial.id))
                  .run();
              },
            );
            this.resources.release(initial.id);
            break;
          } else if (
            error.code === 'UPSTREAM_PROTOCOL_ERROR' &&
            ++protocolFailures >= settings.retryMaxAttempts
          ) {
            store.end(initial.id, { status: 'unknown', code: error.code });
            break;
          }
          // 网络/认证错误由OpenList客户端记录；状态不变，下一周期继续观察。
          if (protocolFailures === 1)
            this.logger.warn('Task protocol unavailable', {
              attemptId: initial.id,
            });
        }
        if (!['submitted', 'running'].includes(store.get(initial.id).status))
          break;
        try {
          await delay(
            Math.max(
              1,
              Math.round(settings.taskPollMs * (0.8 + Math.random() * 0.4)),
            ),
            undefined,
            {
              signal:
                recovering || cancelling
                  ? signal
                  : AbortSignal.any([signal, context.signal]),
            },
          );
        } catch (error) {
          if (!aborted(error, signal) && !aborted(error, context.signal))
            throw error;
          // 取消/期限到达立即进入下一轮收尾，不吞没业务或数据库错误。
        }
      }
      const result = store.get(initial.id);
      if (taskTerminal(result.remoteState) && !this.readiness.stopping)
        await this.cleanup(context, result);
      return store.get(initial.id);
    } finally {
      release();
    }
  }
  /** 状态与终态清理责任原子提交；远程终态才释放额度。
   * @param store Run存取。
   * @param op 当前操作。
   * @param state 已验证远端状态。
   * @param retryable 当前为正常执行且尚未停止，允许按冻结预算安排重试。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  private result(
    store: OperationStore,
    op: ExecutionRecord,
    state: number | null,
    retryable: boolean,
  ): void {
    if (state === null) throw new Error('Task state missing');
    const status = taskStatus(state);
    store.db.transaction(
      /** 保存同一次info的状态及结果，不给历史结果重新执行。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 数据库失败。
       */
      () => {
        if (status === 'submitted' || status === 'running')
          store.transition(op.id, {
            status,
            remoteState: state,
            updatedAt: Date.now(),
          });
        else {
          store.db
            .update(operationAttempts)
            .set({ remoteState: state, updatedAt: Date.now() })
            .where(
              and(
                eq(operationAttempts.id, op.id),
                inArray(operationAttempts.status, ['submitted', 'running']),
              ),
            )
            .run();
          store.end(
            op.id,
            {
              status,
              ...(status === 'succeeded' ? {} : { code: 'OPENLIST_ERROR' }),
            },
            retryable,
          );
        }
      },
    );
    if (taskTerminal(state)) this.resources.release(op.id);
  }
  /** 本地结果落库后尝试一次记录清理；失败交维护，不重复终态统计。
   * @param context 原Run设置。
   * @param op 已终态任务。
   * @returns 有界清理完成。
   * @throws Error 数据库或实现错误。
   */
  private async cleanup(
    context: ExecutionContext,
    op: ExecutionRecord,
  ): Promise<void> {
    if (!op.openlistTaskId) return;
    const fact = taskFact(context.db, op.id);
    if (!fact?.remoteCleanupPending) return;
    try {
      const result = await cleanupTask(
        this.tasks,
        context.instance(op.targetInstanceId),
        op.openlistTaskId,
        {
          settings: context.run.config.settings,
          signal: AbortSignal.any([
            context.hard,
            this.readiness.shutdown.signal,
          ]),
        },
        context.run.config.settings,
        1,
      );
      if (this.readiness.stopping) return;
      if (result.kind === 'failed') {
        this.logger.warn('Task cleanup deferred', { attemptId: op.id });
        return;
      }
      const state = result.kind === 'observed' ? result.state : undefined;
      if (updateTaskFact(context.db, fact, state, result.kind === 'gone')) {
        if (result.kind === 'observed')
          this.resources.hold(op.id, op.runTargetId);
        else this.resources.release(op.id);
      }
    } catch (error) {
      if (
        !(error instanceof OpenListError) &&
        !aborted(error, context.hard) &&
        !aborted(error, this.readiness.shutdown.signal)
      )
        throw error;
      this.logger.warn('Task cleanup deferred', { attemptId: op.id });
    }
  }
}
