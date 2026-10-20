// 承担预览派发、独立队列过期和最小重启收尾，不执行远程写入。
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  OnApplicationBootstrap,
  OnModuleDestroy,
  BeforeApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Server } from 'node:http';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { AppConfig } from '../configuration/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import { runs, runTargets } from '../database/run-schema.js';
import type { RunRecord } from '../database/run-schema.js';
import { operations } from '../database/operation-schema.js';
import { RunQueue } from '../coordination/run-queue.js';
import { Readiness } from '../coordination/coordination.module.js';
import { SyncService } from '../sync/sync.service.js';
import { PlanError } from '../sync/stats.js';
import { errorTraits } from '../common/errors.js';

/** 仅 M2 可产生状态的派发服务。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class RunDispatcher
  implements OnApplicationBootstrap, OnModuleDestroy, BeforeApplicationShutdown
{
  private readonly logger = new Logger(RunDispatcher.name);
  private readonly workers = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private startHandle: ReturnType<typeof setImmediate> | undefined;
  private server: Server | undefined;
  /** 保存协调、数据库及扫描依赖。
   * @param database 数据库。
   * @param config 进程执行位与队列配置。
   * @param queue 协调叶子队列。
   * @param readiness 就绪与停止事实。
   * @param sync 只读规划服务。
   * @param adapter HTTP 生命周期。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(RunQueue) private readonly queue: RunQueue,
    @Inject(Readiness) private readonly readiness: Readiness,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(HttpAdapterHost) private readonly adapter: HttpAdapterHost,
  ) {}
  /** 初始化先收尾旧扫描，再恢复原始 queued 候选。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  onApplicationBootstrap(): void {
    const db = this.database.db;
    const interrupted = db
      .select()
      .from(runs)
      .where(inArray(runs.status, ['scanning', 'planned']))
      .all();
    for (const run of interrupted)
      this.finish(run.id, 'interrupted', 'PROCESS_RESTART', null, 'skipped');
    const queued = db
      .select()
      .from(runs)
      .where(eq(runs.status, 'queued'))
      .orderBy(asc(runs.createdAt), asc(runs.id))
      .all();
    for (const run of queued) this.queue.enqueue(run);
    this.expire();
    this.readiness.recovered = true;
    this.server = this.adapter.httpAdapter.getHttpServer();
    this.server?.once('listening', this.listening);
  }
  /** 等待所有 listening 回调更新 ready 后开始派发。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  private readonly listening = (): void => {
    this.startHandle = setImmediate(
      /** 在其他 listening 回调执行后的下一事件循环清除启动句柄并开始派发。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      () => {
        this.startHandle = undefined;
        this.wake();
      },
    );
  };
  /** 已提交 Run 入队后唤醒，HTTP 响应不等待扫描。
   * @param run 持久化 Run。
   * @returns 不适用。
   * @throws 不适用。
   */
  accept(run: RunRecord): void {
    this.queue.enqueue(run);
    if (!this.startHandle)
      this.startHandle = setImmediate(
        /** 在下一事件循环清除启动句柄并唤醒派发器，使 HTTP 响应不等待扫描。
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
  /** 处理过期并按执行位派发；所有后台异常有明确出口。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用；不可恢复错误触发 fail-fast。
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
      while (
        this.queue.active.size < this.config.globalMaxRuns &&
        this.queue.waiting.length > 0
      ) {
        const entry = this.queue.waiting.shift();
        if (!entry) break;
        const db = this.database.db;
        const row = db
          .select()
          .from(runs)
          .where(and(eq(runs.id, entry.id), eq(runs.status, 'queued')))
          .get();
        if (!row) continue;
        const now = Date.now();
        if (now >= row.queueDeadlineAt) {
          this.finish(row.id, 'failed', null, 'QUEUE_TIMEOUT', 'skipped');
          continue;
        }
        const deadlineAt = now + row.config.job.timeoutSeconds * 1000;
        db.update(runs)
          .set({
            status: 'scanning',
            startedAt: now,
            deadlineAt,
            updatedAt: now,
          })
          .where(eq(runs.id, row.id))
          .run();
        const run = {
          ...row,
          status: 'scanning' as const,
          startedAt: now,
          deadlineAt,
        };
        const controller = new AbortController();
        this.queue.active.add(run.id);
        const promise = this.work(run, controller).catch(
          /** 将异步失败交给已定义的异常出口。
           * @param error worker 未处理的失败，通常是终态持久化失败。
           * @returns 不适用。
           * @throws 不适用。
           */
          (error: unknown) => {
            this.fatal(error);
          },
        );
        this.workers.set(run.id, { controller, promise });
      }
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      if (this.queue.waiting.length > 0) {
        const deadline = Math.min(
          ...this.queue.waiting.map(
            /** 取出等待项的排队截止时间。
             * @param row 等待中的队列条目。
             * @returns 排队截止毫秒。
             * @throws 不适用。
             */
            (row) => row.queueDeadlineAt,
          ),
        );
        this.timer = setTimeout(
          /** 最早的排队期限到期后唤醒派发器以清除过期候选。
           * @param 不适用。
           * @returns 不适用。
           * @throws 不适用。
           */
          () => {
            this.timer = undefined;
            this.wake();
          },
          Math.max(0, deadline - Date.now()),
        );
      }
    } catch (error) {
      this.fatal(error);
    }
  }
  /** 独立于执行位清除过期候选，保留 startedAt=null。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  private expire(): void {
    const now = Date.now();
    for (let i = this.queue.waiting.length - 1; i >= 0; i--) {
      const entry = this.queue.waiting[i];
      if (now < entry.queueDeadlineAt) continue;
      this.finish(entry.id, 'failed', null, 'QUEUE_TIMEOUT', 'skipped');
      this.queue.waiting.splice(i, 1);
    }
  }
  /** 扫描超时只中止本地工作；关机不写 Run 终态。
   * @param run 已开始扫描的 Run。
   * @param controller 本地中止器。
   * @returns 本地工作全部停止。
   * @throws Error 终态持久化失败。
   */
  private async work(
    run: RunRecord,
    controller: AbortController,
  ): Promise<void> {
    let finalized = false;
    const timer = setTimeout(
      /** 扫描期限到期时以 RUN_TIMEOUT 中止本地扫描。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      () => controller.abort(new PlanError('RUN_TIMEOUT')),
      Math.max(0, (run.deadlineAt ?? Date.now()) - Date.now()),
    );
    try {
      await this.sync.preview(
        run,
        AbortSignal.any([controller.signal, this.readiness.shutdown.signal]),
      );
      finalized = true;
    } catch (error) {
      if (!this.readiness.stopping) {
        if (
          controller.signal.aborted &&
          controller.signal.reason instanceof PlanError &&
          controller.signal.reason.code === 'RUN_TIMEOUT'
        )
          this.finish(run.id, 'cancelled', 'RUN_TIMEOUT', null, 'cancelled');
        else {
          const code =
            error instanceof PlanError ? error.code : 'INTERNAL_ERROR';
          this.logger.error('Preview stopped', {
            runId: run.id,
            errorCode: code,
            ...errorTraits(error),
          });
          this.finish(run.id, 'failed', null, code, 'skipped');
        }
      }
      finalized = true;
    } finally {
      clearTimeout(timer);
      this.queue.active.delete(run.id);
      this.workers.delete(run.id);
      // 终态保存失败时由外层 fail-fast；不能在其 catch 运行前派发下一轮。
      if (finalized && !this.readiness.stopping) this.wake();
    }
  }
  /** 原子收尾未派发操作与 Run，预览执行计数保持零。
   * @param id Run ID。
   * @param status 目标终态。
   * @param stopReason 停止原因。
   * @param errorCode Run 失败码。
   * @param operationStatus 剩余 pending 的终态。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  private finish(
    id: string,
    status: 'failed' | 'cancelled' | 'interrupted',
    stopReason: string | null,
    errorCode: string | null,
    operationStatus: 'skipped' | 'cancelled',
  ): void {
    const db = this.database.db;
    const now = Date.now();
    db.transaction(
      /** 在一个事务内将剩余 pending 操作收尾，重算各目标与 Run 的跳过计数，再写入 Run 终态并清除秘密快照。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error Run 记录缺失或数据库失败。
       */
      () => {
        const run = db.select().from(runs).where(eq(runs.id, id)).get();
        if (!run) throw new Error('Run missing during finalization');
        db.update(operations)
          .set({
            status: operationStatus,
            errorCode:
              operationStatus === 'skipped' ? 'PLAN_INTERRUPTED' : null,
            errorMessage:
              operationStatus === 'skipped' ? 'PLAN_INTERRUPTED' : null,
            endedAt: now,
            updatedAt: now,
          })
          .where(
            and(eq(operations.runId, id), eq(operations.status, 'pending')),
          )
          .run();
        const skipped =
          db
            .select({ n: count() })
            .from(operations)
            .where(
              and(eq(operations.runId, id), eq(operations.status, 'skipped')),
            )
            .get()?.n ?? 0;
        for (const target of db
          .select()
          .from(runTargets)
          .where(eq(runTargets.runId, id))
          .all()) {
          const n =
            db
              .select({ n: count() })
              .from(operations)
              .where(
                and(
                  eq(operations.runTargetId, target.id),
                  eq(operations.status, 'skipped'),
                ),
              )
              .get()?.n ?? 0;
          db.update(runTargets)
            .set({ stats: { ...target.stats, skippedOperations: n } })
            .where(eq(runTargets.id, target.id))
            .run();
        }
        db.update(runs)
          .set({
            status,
            stopReason,
            errorCode,
            errorMessage: errorCode,
            endedAt: now,
            updatedAt: now,
            stats: { ...run.stats, skippedOperations: skipped },
            secretSnapshotEnc: null,
          })
          .where(eq(runs.id, id))
          .run();
      },
    );
  }
  /** 停止接收和派发，再中止本地扫描，不改历史结果。
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
  /** 数据库关闭前等待全部本地扫描真正退出。
   * @param 不适用。
   * @returns 等待完成。
   * @throws 不适用；worker 已具有失败处理。
   */
  async beforeApplicationShutdown(): Promise<void> {
    await Promise.all(
      [...this.workers.values()].map(
        /** 取出本地扫描 worker 的完成 Promise。
         * @param worker 在途扫描 worker。
         * @returns 已带失败处理的完成 Promise。
         * @throws 不适用。
         */
        (worker) => worker.promise,
      ),
    );
  }
  /** 数据库无法保存时停止服务并以非零码退出，不输出原始错误。
   * @param error 原始异常，仅提取安全特征。
   * @returns 不适用。
   * @throws Error 下一事件循环抛出固定异常以 fail-fast。
   */
  private fatal(error: unknown): void {
    this.logger.error('Run persistence failed', {
      errorCode: 'INTERNAL_ERROR',
      ...errorTraits(error),
    });
    this.onModuleDestroy();
    setImmediate(
      /** 在下一事件循环抛出固定异常，使进程以未捕获异常退出。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 固定的 Run persistence failed。
       */
      () => {
        throw new Error('Run persistence failed');
      },
    );
  }
}
