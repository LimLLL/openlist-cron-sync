// 计算文档规定的带抖动指数退避，供执行与relay共用。
import type { ExecutionSettings } from '../configuration/execution-settings.js';

/** 按 min(RETRY_MAX_MS, RETRY_BASE_MS×2^(attempt-1)×U[0.5,1.5]) 计算等待毫秒。
 * @param settings Run固定的重试设置。
 * @param attempt 刚失败的尝试序号，从1开始。
 * @returns 含抖动且不超过上限的等待毫秒。
 * @throws 不适用。
 */
export function backoffMs(
  settings: Pick<ExecutionSettings, 'retryBaseMs' | 'retryMaxMs'>,
  attempt: number,
): number {
  return Math.min(
    settings.retryMaxMs,
    settings.retryBaseMs * 2 ** (attempt - 1) * (0.5 + Math.random()),
  );
}
