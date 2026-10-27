// 统一mkdir/remove/空put错误观察；删除始终先刷新前提再确认效果。
import { scanInterval } from '../coordination/scan-pacing.service.js';
import { setTimeout as delay } from 'node:timers/promises';
import type { OperationRecord } from '../database/operation-schema.js';
import type { RunTargetRecord } from '../database/run-schema.js';
import { OpenListError } from '../openlist/errors.js';
import type { FileEntry } from '../openlist/protocol.js';
import { splitPath } from './execution-context.js';
import type { ExecutionContext } from './execution-context.js';
import type { OperationStore, Outcome } from './operation-store.js';
import type { QuarantineObserver } from './quarantine-observer.js';

/** 明确未执行的拒绝，不按上游message细分。
 * @param error 上游协议错误。
 * @returns 是否可证明尚未执行。
 * @throws 不适用。
 */
export function rejected(error: OpenListError): boolean {
  return (
    !error.dispatched ||
    error.code === 'AUTH_BLOCKED' ||
    [400, 401, 403, 405].includes(error.upstreamCode ?? -1)
  );
}
/** 当前观察是否仍满足旧delete前提。
 * @param op 计划动作。
 * @param entry 当前对象。
 * @returns 类型和已知大小是否匹配。
 * @throws 不适用。
 */
function same(op: OperationRecord, entry: FileEntry): boolean {
  return (
    entry.isDir === op.isDir &&
    (op.isDir || entry.size === op.expectedTargetSize)
  );
}
/** 一次有界观察后的明确结果，供Sync决定是否另建attempt。
 * @param context 当前观察上下文。
 * @param target 当前目标。
 * @param op 可能已生效动作。
 * @param error 已收到的有效非成功envelope。
 * @param hard 观察读取的收尾期限；默认Run收尾期限，调用方可叠加文件级硬期限。
 * @returns 规范结果。
 * @throws Error 数据库或本地错误。
 */
export async function observeError(
  context: ExecutionContext,
  target: RunTargetRecord,
  op: OperationRecord,
  error: OpenListError,
  hard: AbortSignal = context.hard,
): Promise<Outcome> {
  if (rejected(error))
    return { status: 'failed', code: error.code, message: error.message };
  if (error.upstreamCode === null)
    return { status: 'unknown', code: error.code, message: error.message };
  try {
    // 观察属于已派发动作的收尾：停止派发后仍在收尾期限内读取。
    const entry = await context.entry(target, op.targetPath, hard);
    let result: 'succeeded' | 'failed' | 'unknown' = 'unknown';
    if (op.action === 'delete')
      result =
        entry === null ? 'succeeded' : same(op, entry) ? 'failed' : 'unknown';
    else if (op.action === 'mkdir')
      result = entry?.isDir
        ? 'succeeded'
        : entry === null
          ? 'failed'
          : 'unknown';
    else
      result =
        entry === null
          ? 'failed'
          : !entry.isDir && entry.size === op.expectedSourceSize
            ? 'succeeded'
            : 'unknown';
    return {
      status: result,
      code: result === 'succeeded' ? 'OBSERVED_AFTER_ERROR' : error.code,
      message: error.message,
    };
  } catch (cause) {
    if (!(cause instanceof OpenListError) && !hard.aborted) throw cause;
    return {
      status: 'unknown',
      code: error.code,
      message: 'Mutation observation unavailable',
    };
  }
}
/** mkdir和单名称删除执行器；不独立调度替换delete。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class Mutations {
  /** 保存当前Run的具体依赖。
   * @param context 固定观察配置。
   * @param store 事务存取。
   * @param quarantine 强制重新观察。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    readonly context: ExecutionContext,
    readonly store: OperationStore,
    private readonly quarantine: QuarantineObserver,
  ) {}
  /** 执行一次mkdir或delete；仅明确观察到未生效的失败可重试。
   * 停止信号只阻止新的提交；已派发请求及删除确认在收尾期限内继续，以取得明确结果而不是直接隔离。
   * @param target 当前目标。
   * @param initial 当前逻辑动作的pending尝试。
   * @param beforeDelete 源准备检查，每次删除尝试执行。
   * @param deadline 调用方附加的硬期限（例如relay单文件总期限），同时约束提交前检查与在途请求。
   * @returns 最后尝试。
   * @throws Error 本地错误、持久化失败或停止；停止时未派发的尝试保持pending。
   */
  async execute(
    target: RunTargetRecord,
    initial: OperationRecord,
    deadline?: AbortSignal,
    beforeDelete?: () => Promise<void>,
  ): Promise<OperationRecord> {
    const stop = deadline
      ? AbortSignal.any([this.context.signal, deadline])
      : this.context.signal;
    const hard = deadline
      ? AbortSignal.any([this.context.hard, deadline])
      : this.context.hard;
    let op = initial;
    for (;;) {
      stop.throwIfAborted();
      if (op.nextAttemptAt)
        await delay(Math.max(0, op.nextAttemptAt - Date.now()), undefined, {
          signal: stop,
        });
      if (!(await this.quarantine.allows(target, op.targetPath, op.action))) {
        this.store.end(op.id, {
          status: 'skipped',
          code: 'PREVIOUS_OUTCOME_UNKNOWN',
        });
        return this.store.get(op.id);
      }
      if (
        op.action === 'delete' &&
        !(await this.precondition(target, op, stop))
      )
        return this.store.get(op.id);
      if (op.action === 'delete') await beforeDelete?.();
      let retryable = false;
      try {
        const instance = this.context.instance(op.targetInstanceId);
        const request = {
          ...this.context.inflight(hard),
          dispatchSignal: stop,
          pacing: scanInterval(
            instance,
            op.targetPath,
            target.config.target.scanIntervalSeconds,
          ),
          /** 在实际派发前提交submitting事务；Run已停止时拒绝派发并保持pending。
           * @param 不适用。
           * @returns 不适用。
           * @throws Error 取消或持久化失败。
           */
          beforeDispatch: () => this.store.submitting(op.id, stop),
        };
        if (op.action === 'mkdir') {
          await this.context.client.mkdir(instance, op.targetPath, request);
          this.store.end(op.id, { status: 'succeeded' });
        } else {
          const { directory, name } = splitPath(op.targetPath);
          await this.context.client.remove(instance, directory, name, request);
          this.store.confirming(op.id);
          await this.confirm(target, op, hard);
        }
      } catch (error) {
        if (!(error instanceof OpenListError)) throw error;
        // 未派发即被停止：保持pending，由Run收尾记cancelled/PLAN_INTERRUPTED。
        if (!error.dispatched && stop.aborted) throw stop.reason;
        // 进程关闭且宽限耗尽：不写无证据的终态，留给下次启动按崩溃窗口恢复。
        if (hard.aborted && this.context.stopping()) throw hard.reason;
        const outcome = await observeError(
          this.context,
          target,
          op,
          error,
          hard,
        );
        if (hard.aborted && this.context.stopping()) throw hard.reason;
        this.store.end(op.id, outcome);
        retryable = outcome.status === 'failed' && !rejected(error);
      }
      const result = this.store.get(op.id);
      if (result.action === 'mkdir' && result.status === 'succeeded') {
        for (const fact of this.quarantine.quarantine.matching(
          target.config.instance,
          result.targetPath,
          'mkdir',
        ))
          if (
            fact.operation.action === 'mkdir' &&
            fact.operation.targetInstanceId === result.targetInstanceId &&
            fact.operation.targetPath === result.targetPath &&
            !this.quarantine.quarantine.active(fact.operation)
          )
            this.quarantine.quarantine.resolve(
              fact.operation.id,
              this.context.run.id,
              'superseded',
            );
      }
      if (!retryable) return result;
      const retry = this.store.retry(result);
      if (!retry) return result;
      op = retry;
    }
  }
  /** 删除前强制读取，禁止把权限错误或非空目录当作可删。
   * @param target 当前目标。
   * @param op 尚未提交delete。
   * @param stop Run 停止及文件期限，同时约束目录间隔等待。
   * @returns 是否仍可提交。
   * @throws Error 非上游错误或取消。
   */
  private async precondition(
    target: RunTargetRecord,
    op: OperationRecord,
    stop: AbortSignal,
  ): Promise<boolean> {
    if (target.deleteBlocked) {
      this.store.end(op.id, { status: 'skipped', code: 'DELETE_BLOCKED' });
      return false;
    }
    try {
      const entry = await this.context.entry(target, op.targetPath, stop);
      if (entry === null) {
        this.store.absent(op.id);
        return false;
      }
      if (!same(op, entry)) {
        this.store.end(op.id, {
          status: 'skipped',
          code: 'PRECONDITION_CHANGED',
        });
        return false;
      }
      if (op.isDir) {
        const content = await this.context.list(
          target,
          op.targetPath,
          'directory',
          stop,
        );
        if (
          content.items.length ||
          content.protectedEntries.length ||
          content.warnings.length
        ) {
          this.store.end(op.id, {
            status: 'skipped',
            code: 'PRECONDITION_CHANGED',
          });
          return false;
        }
      }
      return true;
    } catch (error) {
      stop.throwIfAborted();
      if (!(error instanceof OpenListError)) throw error;
      this.store.end(op.id, {
        status: 'skipped',
        code: 'PRECONDITION_UNVERIFIED',
      });
      return false;
    }
  }
  /** 已收到remove成功后有界确认；恢复复用此路径，不重复remove。
   * @param target 当前目标。
   * @param op running delete。
   * @param hard 确认读取的收尾期限；停止派发后仍在此期限内确认。
   * @returns 已写入确认结果。
   * @throws Error 本地或数据库失败；进程关闭中无法确认时抛出并保持running供恢复确认。
   */
  async confirm(
    target: RunTargetRecord,
    op: OperationRecord,
    hard: AbortSignal = this.context.hard,
  ): Promise<void> {
    const settings = this.context.run.config.settings;
    const until = Date.now() + settings.deleteConfirmTimeoutSeconds * 1000;
    try {
      for (;;) {
        if ((await this.context.entry(target, op.targetPath, hard)) === null) {
          this.store.end(op.id, { status: 'succeeded' });
          return;
        }
        if (Date.now() >= until) {
          this.store.end(op.id, {
            status: 'failed',
            code: 'DELETE_NOT_EFFECTIVE',
          });
          return;
        }
        await delay(
          Math.min(settings.deleteConfirmIntervalMs, until - Date.now()),
          undefined,
          { signal: hard },
        );
      }
    } catch (error) {
      if (!(error instanceof OpenListError) && !hard.aborted) throw error;
      if (hard.aborted && this.context.stopping()) throw hard.reason;
      this.store.end(op.id, {
        status: 'unknown',
        code: error instanceof OpenListError ? error.code : 'OPENLIST_ERROR',
        message: 'Delete confirmation unavailable',
      });
    }
  }
}
