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
import type { OperationRecord } from '../database/operation-schema.js';
import { setImmediate as yieldTurn } from 'node:timers/promises';

/** Target内按序推进的执行阶段。 */
type Phase = 'mkdir' | 'create' | 'files' | 'directories';
/** 单次读取的pending行数，只约束内存，不约束执行并发。 */
const FETCH_SIZE = 32;

/** 阶段内可同时派发的动作数，只取用户配置的配额；0表示不限。
 * 目录删除逐个进行；mkdir与文件删除受目标实例API并发约束；创建受Target文件并发及relay源并发约束。
 * @param target 当前目标。
 * @param phase 当前阶段。
 * @param context 当前Run上下文。
 * @returns 正整数或Infinity。
 * @throws 不适用。
 */
function phaseCapacity(
  target: RunTargetRecord,
  phase: Phase,
  context: ExecutionContext,
): number {
  if (phase === 'directories') return 1;
  const { instance, target: config } = target.config;
  const quotas =
    phase !== 'create'
      ? [instance.limits.maxApiConcurrency]
      : config.createMode === 'relay'
        ? [
            config.concurrentFiles,
            context.run.config.job.sourceDownloadConcurrency,
          ]
        : [config.concurrentFiles];
  return Math.min(
    Infinity,
    ...quotas.filter(
      /** 0表示该配额不限，不参与取最小值。
       * @param value 配额。
       * @returns 是否为有限配额。
       * @throws 不适用。
       */
      (value) => value > 0,
    ),
  );
}

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
      await this.dispatch(
        target,
        phase,
        context,
        store,
        stop,
        /** 按当前阶段执行一个动作并检查新建根的读取屏障。
         * @param op 已认领的pending动作。
         * @returns 当前动作完成。
         * @throws Error 取消或本地错误。
         */
        async (op) => {
          if (
            (phase === 'files' || phase === 'directories') &&
            target.extrasBlocked
          ) {
            store.end(op.id, { status: 'skipped', code: 'DELETE_BLOCKED' });
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
            store.end(op.id, { status: 'skipped', code: 'DEPENDENCY_FAILED' });
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
      );
    }
  }
  /** 在一个阶段内持续补位：任一动作结束即派发下一个，直到没有pending动作。
   * 游标按seq向后翻页并在内存中跳过已认领的逻辑动作，补位开销不随在途数量增长；
   * mkdir结束可能放行seq更早的子目录，因此从头重扫；在途清空后再从头确认没有遗留。
   * @param target 当前目标。
   * @param phase 当前阶段。
   * @param context 观察与停止上下文。
   * @param store 操作事务。
   * @param stop 停止同Run其它工作的控制器。
   * @param perform 执行一个已认领的动作。
   * @returns 本阶段全部动作收敛。
   * @throws Error 取消或本地错误；已启动的动作全部退出后才抛出。
   */
  private async dispatch(
    target: RunTargetRecord,
    phase: Phase,
    context: ExecutionContext,
    store: OperationStore,
    stop: AbortController,
    perform: (op: OperationRecord) => Promise<void>,
  ): Promise<void> {
    const capacity = phaseCapacity(target, phase, context);
    // 已认领的逻辑动作（含协调器自行生成的重试行）在真正提交前仍是pending。
    const claimed = new Set<string>();
    const inFlight = new Set<Promise<void>>();
    let failure: unknown;
    let cursor = -1;
    // 根mkdir会先持久化成功，再异步刷新；依赖SQL尚不能代表根已通过读取屏障。
    let confirmingRoot = false;
    let wake = (): void => undefined;
    try {
      for (;;) {
        context.signal.throwIfAborted();
        const page =
          !confirmingRoot && inFlight.size < capacity
            ? store.pending(
                target.id,
                phase,
                cursor,
                Math.min(FETCH_SIZE, capacity - inFlight.size),
              )
            : [];
        for (const op of page) {
          cursor = op.seq;
          const root = op.retryOf ?? op.id;
          if (claimed.has(root)) continue;
          claimed.add(root);
          const isRoot =
            phase === 'mkdir' && op.targetPath === target.config.target.path;
          if (isRoot) confirmingRoot = true;
          const tracked: Promise<void> = perform(op)
            .catch(
              /** 记录首个本地错误并停止同Run其余工作。
               * @param error 原始错误。
               * @returns 不适用。
               * @throws 不适用。
               */
              (error: unknown) => {
                failure ??= error;
                stop.abort(error);
              },
            )
            .finally(
              /** 归还认领并唤醒派发循环。
               * @param 不适用。
               * @returns 不适用。
               * @throws 不适用。
               */
              () => {
                claimed.delete(root);
                inFlight.delete(tracked);
                if (isRoot) confirmingRoot = false;
                if (phase === 'mkdir') cursor = -1;
                wake();
              },
            );
          inFlight.add(tracked);
          if (confirmingRoot || inFlight.size >= capacity) break;
        }
        if (page.length) {
          // 让已启动的动作先推进，避免无限配额下连续读取占住事件循环。
          await yieldTurn();
          continue;
        }
        if (!inFlight.size) {
          if (cursor < 0) break;
          cursor = -1;
          continue;
        }
        await new Promise<void>(
          /** 等待任一在途动作结束。
           * @param resolve 唤醒回调。
           * @returns 不适用。
           * @throws 不适用。
           */
          (resolve) => {
            wake = resolve;
          },
        );
      }
    } catch (error) {
      failure ??= error;
      stop.abort(error);
    } finally {
      // 所有已启动动作退出后才能让Run终态事务或关机关闭数据库。
      await Promise.all(inFlight);
    }
    if (failure) throw failure;
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
