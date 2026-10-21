// 让后台持久化失败越过定时器包装器，立即撤销就绪并以非零状态退出。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { errorTraits } from '../common/errors.js';
import { Readiness } from './readiness.js';

/** 所有后台入口共享的不可恢复错误出口。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class FatalError {
  private readonly logger = new Logger(FatalError.name);
  private failed = false;
  /** 保存进程停止闸门。
   * @param readiness 就绪及停止广播。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(@Inject(Readiness) private readonly readiness: Readiness) {}
  /** 关闭新工作并在包装器调用栈之外抛出固定摘要。
   * @param error 原始错误，仅记录安全特征。
   * @returns 不适用。
   * @throws Error 下一事件循环抛出固定错误。
   */
  fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.logger.error('Background persistence failed', errorTraits(error));
    this.readiness.beginShutdown();
    setImmediate(
      /** 触发进程失败而不是让scheduler吞掉异常。
       * @param 不适用。
       * @returns 不返回。
       * @throws Error 固定脱敏摘要。
       */
      () => {
        throw new Error('Background persistence failed');
      },
    );
  }
}
