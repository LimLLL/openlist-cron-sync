// 运行详情与操作表共用的状态映射。
import { ACTIVE_RUN_STATUSES } from './run-contract';

/** 状态到 Badge 变体映射。
 * @param status 状态字符串。
 * @returns Badge props。
 * @throws 不适用。
 */
export function statusBadgeProps(status: string): {
  variant: 'success' | 'danger' | 'warning' | 'default' | 'info' | 'active';
  pulse: boolean;
} {
  if (status === 'succeeded') return { variant: 'success', pulse: false };
  if (status === 'failed') return { variant: 'danger', pulse: false };
  if (status === 'partial') return { variant: 'warning', pulse: false };
  if (
    status === 'cancelled' ||
    status === 'interrupted' ||
    status === 'skipped'
  )
    return { variant: 'default', pulse: false };
  if (status === 'cancelling' || status === 'recovering')
    return { variant: 'warning', pulse: true };
  if (status === 'unknown') return { variant: 'danger', pulse: true };
  if (
    ACTIVE_RUN_STATUSES.has(status) ||
    ['submitting', 'submitted', 'running', 'pending'].includes(status)
  )
    return { variant: 'active', pulse: true };
  return { variant: 'info', pulse: false };
}
