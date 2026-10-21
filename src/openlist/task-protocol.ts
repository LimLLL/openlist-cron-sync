// 共享copy任务状态分类及远程记录清理协议，不写本地业务状态。
import { setTimeout as delay } from 'node:timers/promises';
import type { InstanceRecord } from '../database/schema.js';
import type { ExecutionSettings } from '../configuration/execution-settings.js';
import type { RequestContext } from './request-context.js';
import type { OpenListTasks } from './tasks.service.js';
import { OpenListError } from './errors.js';
import { backoffMs } from '../common/backoff.js';

/** 判断远端已明确停止。
 * @param state tache原始状态。
 * @returns 是否远端终态。
 * @throws 不适用。
 */
export function taskTerminal(state: number | null): boolean {
  return state === 2 || state === 4 || state === 7;
}
/** 将task状态投影为规范Operation状态。
 * @param state 已验证0–9状态。
 * @returns 本地状态。
 * @throws 不适用。
 */
export function taskStatus(state: number) {
  if (state === 2) return 'succeeded';
  if (state === 4) return 'cancelled';
  if (state === 7) return 'failed';
  return [1, 3, 6].includes(state) ? 'running' : 'submitted';
}
/** 只识别JSON404，不根据错误message猜测丢失。
 * @param error 协议错误。
 * @returns 是否task已不可见。
 * @throws 不适用。
 */
export function taskGone(error: unknown): boolean {
  return error instanceof OpenListError && error.upstreamCode === 404;
}
/** 清理请求结果。 */
export type TaskCleanup =
  | { /** 记录已移除。 */ kind: 'gone' }
  | {
      /** 查询发现新的状态，必须交给业务持久化。 */ kind: 'observed';
      /** 原始状态。 */ state: number;
    }
  | { /** 有界删除尝试耗尽。 */ kind: 'failed' };
/** 有终态证据后清理单个任务；逐id错误必须再次info。
 * @param tasks 协议客户端。
 * @param instance 固定身份和当前凭据。
 * @param tid 本服务持有的任务ID。
 * @param context 有界请求上下文。
 * @param settings 重试设置。
 * @param attempts 总删除尝试次数，live为1，维护用配置值。
 * @returns 远程记录结果；非终态时立即停止删除。
 * @throws OpenListError 查询失败；Error 中止或本地错误。
 */
export async function cleanupTask(
  tasks: OpenListTasks,
  instance: InstanceRecord,
  tid: string,
  context: RequestContext,
  settings: ExecutionSettings,
  attempts: number,
): Promise<TaskCleanup> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    context.signal?.throwIfAborted();
    try {
      const errors = await tasks.deleteSome(instance, [tid], context);
      if (!Object.hasOwn(errors, tid)) return { kind: 'gone' };
    } catch (error) {
      if (!(error instanceof OpenListError)) throw error;
      if (taskGone(error)) return { kind: 'gone' };
      // 删除结果未知也先info，避免重试管理员已重新启动的任务。
    }
    try {
      const info = await tasks.info(instance, tid, context);
      if (!taskTerminal(info.state))
        return { kind: 'observed', state: info.state };
    } catch (error) {
      if (taskGone(error)) return { kind: 'gone' };
      throw error;
    }
    if (attempt < attempts)
      await delay(backoffMs(settings, attempt), undefined, {
        signal: context.signal,
      });
  }
  return { kind: 'failed' };
}
