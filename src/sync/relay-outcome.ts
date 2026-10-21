// 分类relay尝试并有界中止session，保持文件工作流与传输细节分离。
import { Logger } from '@nestjs/common';
import type { OperationRecord } from '../database/operation-schema.js';
import type { RunTargetRecord } from '../database/run-schema.js';
import type { RelayService } from '../relay/relay.service.js';
import type { PreparedTransfer } from '../relay/relay-types.js';
import { RelayError } from '../relay/errors.js';
import { OpenListError } from '../openlist/errors.js';
import type { ExecutionContext } from './execution-context.js';
import type { Outcome } from './operation-store.js';
import { observeError, rejected } from './mutations.js';
/** relay错误分类和session清理。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class RelayOutcome {
  private readonly logger = new Logger(RelayOutcome.name);
  /** 保存当前执行上下文。
   * @param context Run观察与期限。
   * @param relay 传输服务。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    private readonly context: ExecutionContext,
    private readonly relay: RelayService,
  ) {}
  /** 按提交窗口区分源失败、init不确定性和零字节put观察。
   * @param target 当前目标。
   * @param op 最新持久化状态。
   * @param error 原始失败，不把本地数据库异常当上游错误。
   * @param timedOut 文件总期限是否已到。
   * @returns 规范结果。
   * @throws Error 非预期本地错误。
   */
  async classify(
    target: RunTargetRecord,
    op: OperationRecord,
    error: unknown,
    timedOut: boolean,
  ): Promise<Outcome> {
    if (timedOut)
      return {
        status: op.status === 'pending' ? 'failed' : 'unknown',
        code: 'OPENLIST_ERROR',
        message: 'Relay total deadline exceeded',
      };
    if (error instanceof RelayError)
      return {
        status: error.unknown
          ? 'unknown'
          : error.code === 'SOURCE_CHANGED' && op.status === 'pending'
            ? 'skipped'
            : 'failed',
        code: error.code,
        message: error.message,
      };
    if (!(error instanceof OpenListError)) throw error;
    if (op.status === 'pending')
      return { status: 'failed', code: error.code, message: error.message };
    if (op.expectedSourceSize === 0)
      return observeError(this.context, target, op, error);
    if (rejected(error))
      return { status: 'failed', code: error.code, message: error.message };
    if (op.multipartUploadId === null && error.upstreamCode !== null) {
      try {
        if (
          (await this.context.entry(
            target,
            op.targetPath,
            this.context.hard,
          )) === null
        )
          return { status: 'failed', code: error.code, message: error.message };
      } catch (cause) {
        if (!(cause instanceof OpenListError) && !this.context.hard.aborted)
          throw cause;
      }
    }
    return { status: 'unknown', code: error.code, message: error.message };
  }
  /** 用收尾期限请求abort；失败仍保留原有未知或主动失败责任。
   * @param transfer 有session的传输。
   * @returns 有界清理结束。
   * @throws Error 本地或数据库错误。
   */
  async abort(transfer: PreparedTransfer): Promise<void> {
    try {
      // 取消/超时为CANCEL_GRACE，关闭为SHUTDOWN_GRACE；未停止时主动abort仍受控制API超时约束。
      await this.relay.abort(transfer, this.context.hard);
    } catch (error) {
      if (!(error instanceof OpenListError)) throw error;
      this.logger.warn('Relay abort unavailable', {
        operationId: transfer.input.operationId,
        errorCode: error.code,
      });
    }
  }
}
