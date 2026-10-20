// 派发扫描与真实执行，拥有取消、启动恢复和关闭编排。
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  OnApplicationBootstrap,
  OnModuleDestroy,
  BeforeApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Server } from 'node:http';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { AppConfig } from '../configuration/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import { runs } from '../database/run-schema.js';
import type { RunRecord } from '../database/run-schema.js';
import { RunQueue } from '../coordination/run-queue.js';
import { Readiness } from '../coordination/coordination.module.js';
import { PathOccupancy } from '../coordination/path-occupancy.js';
import { SyncService } from '../sync/sync.service.js';
import { Executor } from '../sync/executor.service.js';
import { PlanError } from '../sync/stats.js';
import { errorTraits, ApiError } from '../common/errors.js';
import { finishRun, recoveringRun, TERMINAL_RUNS } from './run-finalizer.js';

/** 关闭宽限到期后等待worker完成本地收尾的固定余量，毫秒。 */
const SHUTDOWN_SETTLE_MS = 5000;
/** 正在执行或恢复的本地生命周期。 */
interface Worker {
  /** 停止本地工作，清理使用独立期限。 */
  controller: AbortController;
  /** 已带fail-fast处理的完成Promise。 */
  promise: Promise<void>;
}
/** 单进程运行派发器，不注册cron。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class RunDispatcher
  implements OnApplicationBootstrap, OnModuleDestroy, BeforeApplicationShutdown
{
  private readonly logger = new Logger(RunDispatcher.name);
  private readonly workers = new Map<string, Worker>();
  private timer?: ReturnType<typeof setTimeout>;
  private startHandle?: ReturnType<typeof setImmediate>;
  private server?: Server;
  /** 保存单向依赖和共享协调资源。
   * @param database 数据库。
   * @param config 进程资源限制。
   * @param queue FIFO与执行位。
   * @param readiness 进程就绪状态。
   * @param paths 全局路径占用。
   * @param sync 扫描规划。
   * @param executor 执行和已知副作用恢复。
   * @param adapter HTTP监听生命周期。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(RunQueue) private readonly queue: RunQueue,
    @Inject(Readiness) private readonly readiness: Readiness,
    @Inject(PathOccupancy) private readonly paths: PathOccupancy,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(Executor) private readonly executor: Executor,
    @Inject(HttpAdapterHost) private readonly adapter: HttpAdapterHost,
  ) {}
  /** 先重建责任，再清spool、重排queued并开放HTTP派发。
   * @param 不适用。
   * @returns 责任重建完成；远端恢复可继续后台进行。
   * @throws Error 数据库或spool清理失败。
   */
  async onApplicationBootstrap(): Promise<void> {
    const db = this.database.db;
    const old = db
      .select()
      .from(runs)
      .where(
        inArray(runs.status, [
          'scanning',
          'planned',
          'executing',
          'cancelling',
          'recovering',
        ]),
      )
      .all();
    for (const run of old) this.paths.restore(run);
    for (const run of old) {
      if (run.status === 'scanning' || run.status === 'planned') {
        finishRun(db, run.id, 'interrupted', 'PROCESS_RESTART');
        this.paths.release(run.id);
      }
    }
    await this.executor.resetSpool();
    for (const run of old) {
      if (run.status === 'scanning' || run.status === 'planned') continue;
      const recovering = recoveringRun(db, run.id);
      const controller = new AbortController();
      const promise = this.recover(recovering, controller).catch(
        /** 把后台拒绝交给统一持久化失败出口。
         * @param error 原始错误，仅转换为受控结果或安全特征。
         * @returns 不适用。
         * @throws 不适用。
         */
        (error: unknown) => this.fatal(error),
      );
      this.workers.set(run.id, { controller, promise });
    }
    for (const run of db
      .select()
      .from(runs)
      .where(eq(runs.status, 'queued'))
      .orderBy(asc(runs.createdAt), asc(runs.id))
      .all())
      this.queue.enqueue(run);
    this.expire();
    this.readiness.recovered = true;
    this.server = this.adapter.httpAdapter.getHttpServer();
    this.server?.once('listening', this.listening);
  }
  /** 等待其它监听回调完成后派发。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  private readonly listening = (): void => this.schedule();
  /** 在下一事件循环唤醒，不让HTTP触发等待扫描。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  private schedule(): void {
    if (!this.startHandle)
      this.startHandle = setImmediate(
        /** 清除唤醒句柄后按当前就绪状态派发。
         * @param 不适用。
         * @returns 不适用。
         * @throws 不适用。
         */
        () => {
          this.startHandle = undefined;
          this.wake();
        },
      );
  }
  /** 已落库Run加入FIFO。
   * @param run queued记录。
   * @returns 不适用。
   * @throws 不适用。
   */
  accept(run: RunRecord): void {
    this.queue.enqueue(run);
    this.schedule();
  }
  /** 按FIFO尝试取得全部路径和执行位，冲突项保留排队。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用；不可恢复错误fail-fast。
   */
  private wake(): void {
    if (
      this.readiness.stopping ||
      !this.readiness.ready ||
      !this.readiness.recovered
    )
      return;
    try {
      this.expire();
      for (
        let index = 0;
        index < this.queue.waiting.length &&
        this.queue.active.size < this.config.globalMaxRuns;
      ) {
        const entry = this.queue.waiting[index];
        const row = this.database.db
          .select()
          .from(runs)
          .where(and(eq(runs.id, entry.id), eq(runs.status, 'queued')))
          .get();
        if (!row) {
          this.queue.waiting.splice(index, 1);
          continue;
        }
        if (!this.paths.acquire(row)) {
          index++;
          continue;
        }
        this.queue.waiting.splice(index, 1);
        const now = Date.now();
        const run = {
          ...row,
          status: 'scanning' as const,
          startedAt: now,
          deadlineAt: now + row.config.job.timeoutSeconds * 1000,
        };
        this.database.db
          .update(runs)
          .set({
            status: run.status,
            startedAt: now,
            deadlineAt: run.deadlineAt,
            updatedAt: now,
          })
          .where(eq(runs.id, run.id))
          .run();
        this.queue.active.add(run.id);
        const controller = new AbortController();
        const promise = this.work(run, controller).catch(
          /** 把后台拒绝交给统一持久化失败出口。
           * @param error 原始错误，仅转换为受控结果或安全特征。
           * @returns 不适用。
           * @throws 不适用。
           */
          (error: unknown) => this.fatal(error),
        );
        this.workers.set(run.id, { controller, promise });
      }
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      if (this.queue.waiting.length)
        this.timer = setTimeout(
          /** 队列期限到达后处理过期并重新派发。
           * @param 不适用。
           * @returns 不适用。
           * @throws 不适用。
           */
          () => this.wake(),
          Math.max(
            0,
            Math.min(
              ...this.queue.waiting.map(
                /** 提取候选Run原有的排队截止时刻。
                 * @param row 当前查询记录。
                 * @returns UTC毫秒。
                 * @throws 不适用。
                 */
                (row) => row.queueDeadlineAt,
              ),
            ) - Date.now(),
          ),
        );
    } catch (error) {
      this.fatal(error);
    }
  }
  /** 队列过期不依赖执行位或路径是否空闲。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  private expire(): void {
    for (let i = this.queue.waiting.length - 1; i >= 0; i--) {
      const entry = this.queue.waiting[i];
      if (Date.now() < entry.queueDeadlineAt) continue;
      finishRun(this.database.db, entry.id, 'failed', null, 'QUEUE_TIMEOUT');
      this.queue.waiting.splice(i, 1);
    }
  }
  /** 持久化取消意图并停止新派发，重复请求不重复abort。
   * @param id Run ID。
   * @param reason 用户取消或Run总期限。
   * @returns 当前Run记录。
   * @throws ApiError Run不存在；Error 数据库失败。
   */
  cancel(
    id: string,
    reason: 'USER_CANCEL' | 'RUN_TIMEOUT' = 'USER_CANCEL',
  ): RunRecord {
    const db = this.database.db;
    const row = db.select().from(runs).where(eq(runs.id, id)).get();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Run not found');
    if (TERMINAL_RUNS.includes(row.status) || row.cancelRequestedAt !== null)
      return row;
    const now = Date.now();
    db.update(runs)
      .set({
        cancelRequestedAt: now,
        updatedAt: now,
        ...(row.status === 'recovering'
          ? {}
          : { status: 'cancelling' as const, stopReason: reason }),
      })
      .where(eq(runs.id, id))
      .run();
    if (row.status === 'queued') {
      finishRun(db, id, 'cancelled', reason);
      const index = this.queue.waiting.findIndex(
        /** 匹配需要从队列移除的已取消Run。
         * @param entry 当前队列或目录条目。
         * @returns 是否是指定Run。
         * @throws 不适用。
         */
        (entry) => entry.id === id,
      );
      if (index >= 0) this.queue.waiting.splice(index, 1);
    } else if (row.status !== 'recovering')
      this.workers.get(id)?.controller.abort(new PlanError(reason));
    const current = db.select().from(runs).where(eq(runs.id, id)).get();
    if (!current) throw new Error('Cancelled run missing');
    return current;
  }
  /** 持有执行位贯穿扫描、安全检查和执行。
   * @param run 已派发Run。
   * @param controller 本地停止器。
   * @returns 全部本地工作退出。
   * @throws Error 终态持久化失败。
   */
  private async work(
    run: RunRecord,
    controller: AbortController,
  ): Promise<void> {
    const timer = setTimeout(
      /** 把后台拒绝交给统一持久化失败出口。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      () => {
        try {
          this.cancel(run.id, 'RUN_TIMEOUT');
        } catch (error) {
          this.fatal(error);
        }
      },
      Math.max(0, (run.deadlineAt ?? Date.now()) - Date.now()),
    );
    const signal = AbortSignal.any([
      controller.signal,
      this.readiness.shutdown.signal,
    ]);
    let persisted = false;
    try {
      await this.sync.preview(run, signal);
      if (!run.dryRun) {
        const current = this.database.db
          .select()
          .from(runs)
          .where(eq(runs.id, run.id))
          .get();
        if (!current) throw new Error('Planned run missing');
        signal.throwIfAborted();
        if (current.status === 'executing') {
          await this.executor.execute(current, signal);
          signal.throwIfAborted();
          finishRun(this.database.db, run.id);
        }
      }
      persisted = true;
    } catch (error) {
      if (!this.readiness.stopping) {
        if (controller.signal.aborted)
          finishRun(
            this.database.db,
            run.id,
            'cancelled',
            controller.signal.reason instanceof PlanError
              ? controller.signal.reason.code
              : 'USER_CANCEL',
          );
        else {
          const code =
            error instanceof PlanError ? error.code : 'INTERNAL_ERROR';
          this.logger.error('Run stopped', {
            runId: run.id,
            errorCode: code,
            ...errorTraits(error),
          });
          finishRun(this.database.db, run.id, 'failed', null, code);
        }
      }
      persisted = true;
    } finally {
      clearTimeout(timer);
      this.workers.delete(run.id);
      this.queue.active.delete(run.id);
      if (persisted || this.readiness.stopping) this.paths.release(run.id);
      if (persisted && !this.readiness.stopping) this.schedule();
    }
  }
  /** 恢复只保留路径占用，不占新运行执行位。
   * @param run 已进入recovering。
   * @param controller 当前进程恢复停止器。
   * @returns 恢复结束。
   * @throws Error 数据库失败。
   */
  private async recover(
    run: RunRecord,
    controller: AbortController,
  ): Promise<void> {
    const signal = AbortSignal.any([
      controller.signal,
      this.readiness.shutdown.signal,
      AbortSignal.timeout(
        Math.max(0, (run.recoveryDeadlineAt ?? Date.now()) - Date.now()),
      ),
    ]);
    try {
      await this.executor.recover(run, signal);
      if (!this.readiness.stopping)
        finishRun(this.database.db, run.id, 'interrupted', 'PROCESS_RESTART');
    } finally {
      this.workers.delete(run.id);
      this.paths.release(run.id);
      if (!this.readiness.stopping) this.schedule();
    }
  }
  /** 撤销就绪并停止本地数据工作，不写Run终态。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  onModuleDestroy(): void {
    this.readiness.beginShutdown();
    if (this.timer) clearTimeout(this.timer);
    if (this.startHandle) clearImmediate(this.startHandle);
    this.server?.off('listening', this.listening);
    for (const worker of this.workers.values())
      worker.controller.abort(new PlanError('PROCESS_RESTART'));
  }
  /** 数据库关闭前等待本地清理；到宽限后进程必须退出而非留下晚回调。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 超过关闭宽限。
   */
  async beforeApplicationShutdown(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(
          [...this.workers.values()].map(
            /** 提取数据库关闭前必须等待的本地工作。
             * @param worker 当前本地工作。
             * @returns 已经安装异常处理的完成Promise。
             * @throws 不适用。
             */
            (worker) => worker.promise,
          ),
        ),
        new Promise<never>(
          /** 关闭宽限届满时拒绝等待，禁止在晚回调仍存在时关闭数据库。
           * @param _resolve 正常完成回调，本超时分支不调用。
           * @param reject 交付失败的回调。
           * @returns 不适用。
           * @throws 不适用。
           */ (_resolve, reject) => {
            timer = setTimeout(
              /** 关闭宽限届满时拒绝等待，禁止在晚回调仍存在时关闭数据库。
               * @param 不适用。
               * @returns 不适用。
               * @throws 不适用。
               */
              () => reject(new Error('Shutdown grace exceeded')),
              // 宽限到期时在途远端动作已被中止，余量只覆盖随后的本地持久化与资源释放。
              this.config.shutdownGraceSeconds * 1000 + SHUTDOWN_SETTLE_MS,
            );
          },
        ),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  /** 持久化无法继续时阻止任何后续派发并退出。
   * @param error 本地错误，仅记录安全特征。
   * @returns 不适用。
   * @throws Error 下一事件循环抛出固定错误。
   */
  private fatal(error: unknown): void {
    this.logger.error('Run persistence failed', {
      errorCode: 'INTERNAL_ERROR',
      ...errorTraits(error),
    });
    this.onModuleDestroy();
    setImmediate(
      /** 以固定摘要终止无法继续保存责任的进程。
       * @param 不适用。
       * @returns 不返回。
       * @throws Error 固定持久化失败摘要。
       */
      () => {
        throw new Error('Run persistence failed');
      },
    );
  }
}
