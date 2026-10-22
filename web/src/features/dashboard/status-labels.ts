// 概览共用的状态工具：宽类型状态映射为共享译文与徽标样式，未知值原样显示，不丢信息。
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import enCommon from '../../i18n/locales/en/common';
import type { DashboardInstance, DashboardRun } from './dashboard-contract';

/** 共享文案中已有译文的 Run 状态。 */
type RunStatusKey = keyof typeof enCommon.runStatus;
/** 共享文案中已有译文的操作动作。 */
type OperationActionKey = keyof typeof enCommon.operationAction;
/** Badge 可用的语义变体。 */
export type BadgeTone =
  'default' | 'success' | 'warning' | 'danger' | 'info' | 'active';
/** 实例在星图与列表中的健康分类。 */
export type InstanceHealth = 'ready' | 'blocked' | 'error' | 'untested';

/** 进行中的 Run 状态，需要轮询与呼吸光环。 */
export const ACTIVE_RUN_STATES: ReadonlySet<string> = new Set([
  'queued',
  'scanning',
  'planned',
  'executing',
  'cancelling',
  'recovering',
]);

/** 判断 Run 状态是否有共享译文。
 * @param value 后端返回的状态。
 * @returns 是否为已知状态。
 * @throws 不适用。
 */
function isRunStatus(value: string): value is RunStatusKey {
  return Object.hasOwn(enCommon.runStatus, value);
}

/** 判断操作动作是否有共享译文。
 * @param value 后端返回的动作。
 * @returns 是否为已知动作。
 * @throws 不适用。
 */
function isOperationAction(value: string): value is OperationActionKey {
  return Object.hasOwn(enCommon.operationAction, value);
}

/** 把 Run 状态映射为徽标色调。
 * @param status Run 状态。
 * @returns Badge 变体。
 * @throws 不适用。
 */
export function runTone(status: string): BadgeTone {
  if (ACTIVE_RUN_STATES.has(status))
    return status === 'cancelling' || status === 'recovering'
      ? 'warning'
      : 'active';
  if (status === 'succeeded') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'partial') return 'warning';
  if (status === 'queued') return 'info';
  return 'default';
}

/** 归类实例健康：被阻止优先，其次是最近测试出错。
 * @param instance 实例摘要。
 * @returns 健康分类。
 * @throws 不适用。
 */
export function instanceHealth(instance: DashboardInstance): InstanceHealth {
  if (instance.authState === 'auth_blocked') return 'blocked';
  if (instance.authState === 'ready') return 'ready';
  return instance.lastError ? 'error' : 'untested';
}

/** 找出最近一次运行失败或部分成功的任务，供星图把对应路径标为告警色。
 * @param runs 按时间倒序的近期运行。
 * @returns 任务 ID 集合。
 * @throws 不适用。
 */
export function failingJobIds(runs: DashboardRun[]): Set<string> {
  const seen = new Set<string>();
  const failing = new Set<string>();
  for (const run of runs) {
    if (seen.has(run.jobId) || ACTIVE_RUN_STATES.has(run.status)) continue;
    seen.add(run.jobId);
    if (run.status === 'failed' || run.status === 'partial')
      failing.add(run.jobId);
  }
  return failing;
}

/** 提供随语言切换更新的状态/动作标签函数。
 * @returns run 与 action 两个标签函数。
 * @throws 不适用。
 */
export function useStatusLabels() {
  const { t } = useTranslation('common');
  return useMemo(
    () => ({
      /** Run 状态标签。 */
      run: (status: string) =>
        isRunStatus(status) ? t(`runStatus.${status}`) : status,
      /** 操作动作标签。 */
      action: (action: string) =>
        isOperationAction(action) ? t(`operationAction.${action}`) : action,
    }),
    [t],
  );
}
