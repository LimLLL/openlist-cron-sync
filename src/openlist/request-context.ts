// 传递运行固定参数与取消信号，认证 single-flight 的等待可独立取消。
import type { ScanInterval } from '../coordination/scan-pacing.service.js';
import type { ExecutionSettings } from '../configuration/execution-settings.js';

/** 调用方上下文；普通浏览省略时使用进程配置。 */
export interface RequestContext {
  /** 本次 Run 的固定参数。 */
  settings?: ExecutionSettings;
  /** 调用方停止信号，不取消其他调用方共用的登录。 */
  signal?: AbortSignal;
  /** 只约束实际派发前的认证/间隔等待，不中断已发出的请求。 */
  dispatchSignal?: AbortSignal;
  /** 调用点显式声明扫描或目录变更间隔；单项观察不传。 */
  pacing?: ScanInterval;
  /** 在认证/间隔就绪后、实际提交前持久化；读取不传。 */
  beforeDispatch?: () => void;
  /** 关闭收尾允许使用独立期限，仍不允许新的文件写入。 */
  cleanup?: boolean;
}
/** 独立取消共享认证的等待，认证结果仍由原 Promise 收敛。
 * @template T 共享结果类型。
 * @param promise 已拥有错误处理的共享工作。
 * @param signal 当前调用方信号。
 * @returns 结果或当前调用方取消。
 * @throws Error 原工作失败或 signal 的取消原因。
 */
export async function waitForAuthentication<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>(
    /** 将共享工作结果与当前调用方的取消竞争收敛到新 Promise。
     * @param resolve 交付共享工作结果。
     * @param reject 交付共享工作错误或取消原因。
     * @returns 不适用。
     * @throws 不适用。
     */ (resolve, reject) => {
      const abort =
        /** 当前调用方取消时移除监听并以 signal 原因拒绝。
         * @param 不适用。
         * @returns 不适用。
         * @throws 不适用。
         */
        (): void => {
          signal.removeEventListener('abort', abort);
          reject(signal.reason);
        };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      promise.then(
        /** 共享工作成功时移除取消监听并交付结果。
         * @param value 共享工作结果。
         * @returns 不适用。
         * @throws 不适用。
         */
        (value) => {
          signal.removeEventListener('abort', abort);
          resolve(value);
        },
        /** 共享工作失败时移除取消监听并传递原错误。
         * @param error 共享工作错误。
         * @returns 不适用。
         * @throws 不适用。
         */
        (error: unknown) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        },
      );
    },
  );
}
