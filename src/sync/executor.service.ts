// 执行数据库计划并恢复已知副作用；Runs仍拥有运行终态事务。
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { operations } from '../database/operation-schema.js';
import { runTargets, scanIssues } from '../database/run-schema.js';
import type { RunRecord, RunTargetRecord } from '../database/run-schema.js';
import { KeysService } from '../security/keys.service.js';
import { OpenListClient } from '../openlist/client.service.js';
import { ExecutionRecovery } from './execution-recovery.js';
import { CopyTracker } from './copy-tracker.js';
import { OpenListError } from '../openlist/errors.js';
import { RelayService } from '../relay/relay.service.js';
import { RelayResources } from '../coordination/relay-resources.js';
import { Readiness } from '../coordination/coordination.module.js';
import { Quarantine } from '../coordination/quarantine.js';
import { ExecutionContext, runSecrets } from './execution-context.js';
import { QuarantineObserver } from './quarantine-observer.js';
import { OperationStore } from './operation-store.js';
import { Mutations } from './mutations.js';
import { FileCoordinator } from './file-coordinator.js';
import { targetResult } from './results.js';

/** 具体执行器，内存仅保存有界批次及活动文件协调器。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class Executor {
  /** 保存单向依赖。
   * @param database 数据库。
   * @param keys 路径密码解密。
   * @param client 文件协议。
   * @param recovery 已提交动作恢复。
   * @param copies copy任务生命周期。
   * @param relay 具体传输实现。
   * @param resources 共享relay资源。
   * @param quarantine 持久未知责任。
   * @param readiness 进程停止状态和独立的关闭清理期限。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) readonly database: DatabaseService,
    @Inject(KeysService) private readonly keys: KeysService,
    @Inject(OpenListClient) private readonly client: OpenListClient,
    @Inject(ExecutionRecovery) private readonly recovery: ExecutionRecovery,
    @Inject(CopyTracker) private readonly copies: CopyTracker,
    @Inject(RelayService) private readonly relay: RelayService,
    @Inject(RelayResources) private readonly resources: RelayResources,
    @Inject(Quarantine) private readonly quarantine: Quarantine,
    @Inject(Readiness) private readonly readiness: Readiness,
  ) {}
  /** 为扫描、执行或恢复构造当前Run的观察能力。
   * @param run 固定Run。
   * @param signal 停止派发新工作的信号。
   * @param cleanup 是否为恢复/关闭收尾。
   * @param hard 已派发动作的收尾期限；省略时与signal相同。
   * @returns 不持久化的观察上下文。
   * @throws Error 密码解密失败。
   */
  context(
    run: RunRecord,
    signal: AbortSignal,
    cleanup = false,
    hard: AbortSignal = signal,
  ): ExecutionContext {
    return new ExecutionContext(
      this.database.db,
      this.client,
      run,
      runSecrets(this.keys, run),
      signal,
      cleanup,
      hard,
      /** 判断进程关闭，以区分取消和SIGTERM收尾。
       * @param 不适用。
       * @returns 是否关闭。
       * @throws 不适用。
       */
      () => this.readiness.stopping,
    );
  }
  /** 停止信号触发后再给已派发动作一段收尾宽限：取消/超时/本地错误用CANCEL_GRACE，进程关闭用SHUTDOWN_GRACE。
   * @param run 固定Run，提供快照中的取消宽限。
   * @param stop 停止派发信号。
   * @returns 收尾信号及释放监听的dispose；后来的SIGTERM仍可缩短取消宽限。
   * @throws 不适用。
   */
  private grace(run: RunRecord, stop: AbortSignal) {
    const hard = new AbortController();
    const listeners = new AbortController();
    /** 停止发生时按当时的停止原因选择宽限并在到期后中止在途动作。
     * @param 不适用。
     * @returns 不适用。
     * @throws 不适用。
     */
    const arm = (): void => {
      const limit = this.readiness.stopping
        ? (this.readiness.cleanupSignal ?? AbortSignal.timeout(0))
        : AbortSignal.timeout(run.config.settings.cancelGraceSeconds * 1000);
      if (limit.aborted) hard.abort(stop.reason);
      else
        limit.addEventListener('abort', hard.abort.bind(hard, stop.reason), {
          once: true,
          signal: listeners.signal,
        });
    };
    if (stop.aborted) arm();
    else
      stop.addEventListener('abort', arm, {
        once: true,
        signal: listeners.signal,
      });
    // stop可能早已因用户取消触发；关机必须独立观察，且Run退出后移除监听。
    const shutdown = AbortSignal.any([this.readiness.shutdown.signal]);
    shutdown.addEventListener('abort', arm, {
      once: true,
      signal: listeners.signal,
    });
    return {
      signal: hard.signal,
      /** Run退出后解除全局关闭监听，并保持shutdown代理在活动期有强引用。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      dispose: () => {
        shutdown.removeEventListener('abort', arm);
        listeners.abort();
      },
    };
  }
  /** 为扫描复用相同隔离观察策略。
   * @param run 固定Run。
   * @param signal 扫描停止信号。
   * @returns 当前Run观察器。
   * @throws Error 快照解密失败。
   */
  observer(run: RunRecord, signal: AbortSignal): QuarantineObserver {
    return new QuarantineObserver(this.context(run, signal), this.quarantine);
  }
  /** 完整执行各Target，单Target的已分类失败不取消其它Target。
   * @param run executing Run。
   * @param signal Run停止信号。
   * @returns 所有本地工作已退出。
   * @throws Error 取消、数据库或实现错误。
   */
  async execute(run: RunRecord, signal: AbortSignal): Promise<void> {
    const stop = new AbortController();
    const stopping = AbortSignal.any([signal, stop.signal]);
    const grace = this.grace(run, stopping);
    const context = this.context(run, stopping, false, grace.signal);
    const store = new OperationStore(this.database.db, run);
    const observer = new QuarantineObserver(context, this.quarantine);
    const mutations = new Mutations(context, store, observer);
    const files = new FileCoordinator(
      context,
      store,
      this.relay,
      mutations,
      observer,
      stop.abort.bind(stop),
      this.copies,
    );
    const targets = this.database.db
      .select()
      .from(runTargets)
      .where(eq(runTargets.runId, run.id))
      .all();
    const workers = targets.map(
      /** 启动一个目标的独立阶段执行。
       * @param target 当前目标事实。
       * @returns 该目标收敛的Promise。
       * @throws Error 取消或不可恢复本地错误。
       */
      (target) => this.target(target, context, store, mutations, files, stop),
    );
    try {
      await Promise.all(workers);
    } catch (error) {
      stop.abort(error);
      await Promise.allSettled(workers);
      throw error;
    } finally {
      grace.dispose();
      this.resources.releaseJob(run.jobId);
    }
  }
  /** 独立推进一个Target的四个阶段。
   * @param target 当前目标。
   * @param context 观察与停止上下文。
   * @param store 操作事务。
   * @param mutations mkdir/delete执行。
   * @param files 文件协调器。
   * @param stop 停止同Run其它目标的控制器。
   * @returns Target收敛。
   * @throws Error 本地错误或取消。
   */
  private async target(
    target: RunTargetRecord,
    context: ExecutionContext,
    store: OperationStore,
    mutations: Mutations,
    files: FileCoordinator,
    stop: AbortController,
  ): Promise<void> {
    for (const phase of ['mkdir', 'create', 'files', 'directories'] as const) {
      if (phase === 'files') {
        const result = targetResult(context.db, target, true).target;
        target.extrasBlocked = result.extrasBlocked;
        target.blockReasons = result.blockReasons;
        context.db
          .update(runTargets)
          .set({
            extrasBlocked: target.extrasBlocked,
            blockReasons: target.blockReasons,
          })
          .where(eq(runTargets.id, target.id))
          .run();
      }
      for (;;) {
        context.signal.throwIfAborted();
        const batch = store.pending(target.id, phase);
        if (!batch.length) break;
        const settled = await Promise.allSettled(
          batch
            .map(
              /** 按当前阶段执行一个动作并检查新建根的读取屏障。
               * @param op 当前pending动作。
               * @returns 当前动作完成。
               * @throws Error 取消或本地错误。
               */
              async (op) => {
                if (
                  (phase === 'files' || phase === 'directories') &&
                  target.extrasBlocked
                ) {
                  store.end(op.id, {
                    status: 'skipped',
                    code: 'DELETE_BLOCKED',
                  });
                  return;
                }
                const dependencies = store.dependencies(op.id);
                if (
                  phase !== 'create' &&
                  dependencies.some(
                    /** 判断必要父依赖是否尚未成功。
                     * @param dependency 必要依赖操作。
                     * @returns 是否应阻断当前动作。
                     * @throws 不适用。
                     */
                    (dependency) => dependency.status !== 'succeeded',
                  )
                ) {
                  store.end(op.id, {
                    status: 'skipped',
                    code: 'DEPENDENCY_FAILED',
                  });
                  return;
                }
                if (phase === 'create') await files.execute(target, op);
                else {
                  const result = await mutations.execute(target, op);
                  if (
                    phase === 'mkdir' &&
                    result.status === 'succeeded' &&
                    op.targetPath === target.config.target.path
                  ) {
                    try {
                      await context.list(target, op.targetPath);
                    } catch (error) {
                      context.signal.throwIfAborted();
                      if (!(error instanceof OpenListError)) throw error;
                      this.rootUnavailable(target, store);
                    }
                  }
                }
              },
            )
            .map(
              /** 给每个批内工作安装停止同Run其它工作的异常出口。
               * @param work 本批次的异步工作。
               * @returns 保留失败信息的Promise。
               * @throws Error 原工作失败。
               */
              (work) =>
                work.catch(
                  /** 停止同Run其余工作并保留原本地错误。
                   * @param error 原始错误，仅转换为受控结果或安全特征。
                   * @returns 不返回。
                   * @throws Error 原工作失败。
                   */
                  (error: unknown) => {
                    stop.abort(error);
                    throw error;
                  },
                ),
            ),
        );
        const rejected = settled.find(
          /** 在已全部退出的工作中定位拒绝结果。
           * @param result 已完成的工作或聚合结果。
           * @returns 是否失败。
           * @throws 不适用。
           */
          (result) => result.status === 'rejected',
        );
        if (rejected?.status === 'rejected') throw rejected.reason;
      }
    }
  }
  /** 新根创建后无法读取时保留mkdir成功并阻断该Target子动作。
   * @param target 当前目标。
   * @param store 操作事务。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  private rootUnavailable(
    target: RunTargetRecord,
    store: OperationStore,
  ): void {
    const now = Date.now();
    target.targetComplete = false;
    target.deleteBlocked = true;
    target.extrasBlocked = true;
    if (!target.blockReasons.includes('TARGET_ROOT_UNAVAILABLE'))
      target.blockReasons.push('TARGET_ROOT_UNAVAILABLE');
    this.database.db.transaction(
      /** 原子记录新根不可用并阻断该目标剩余pending动作。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 数据库失败。
       */
      () => {
        this.database.db
          .insert(scanIssues)
          .values({
            id: randomUUID(),
            runId: store.run.id,
            runTargetId: target.id,
            endpointRole: 'target',
            instanceId: target.config.instance.id,
            path: target.config.target.path,
            code: 'TARGET_ROOT_UNAVAILABLE',
            message: 'TARGET_ROOT_UNAVAILABLE',
            protectSubtree: true,
            createdAt: now,
          })
          .run();
        this.database.db
          .update(runTargets)
          .set({
            targetComplete: false,
            deleteBlocked: true,
            extrasBlocked: true,
            blockReasons: target.blockReasons,
          })
          .where(eq(runTargets.id, target.id))
          .run();
        this.database.db
          .update(operations)
          .set({
            status: 'skipped',
            errorCode: 'DEPENDENCY_FAILED',
            errorMessage: 'Target root refresh unavailable',
            endedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(operations.runTargetId, target.id),
              eq(operations.status, 'pending'),
            ),
          )
          .run();
      },
    );
  }
  /** 恢复已提交动作；具体task与relay恢复共用单向协作。
   * @param run 原运行。
   * @param signal 进程停止。
   * @returns 恢复完成。
   * @throws Error 数据库或实现错误。
   */
  recover(run: RunRecord, signal: AbortSignal): Promise<void> {
    return this.recovery.recover(run, signal);
  }
  /** 责任重建完成后清空旧进程块，不续传。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 文件系统清理失败。
   */
  resetSpool(): Promise<void> {
    return this.relay.spool.reset();
  }
}
