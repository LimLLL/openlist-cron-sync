// 计算每目标固定删除预算，不在此执行任何操作。
import type { DeleteLimits } from '../jobs/job-types.js';

/** 保护计算结果。 */
export interface SafetyResult {
  /** 有效文件删除预算；保护阻断为 0，数值保护禁用为 null。 */
  budget: number | null;
  /** 需要跳过的操作原因。 */
  code: 'DELETE_BLOCKED' | 'DELETE_LIMIT' | null;
  /** R>D 是不可覆盖的实现缺陷。 */
  invalidPlan: boolean;
}
/** 使用整数运算计算预算，阈值相等允许。
 * @param denominator 受管理目标文件数 D。
 * @param replacements 替换候选数。
 * @param extras 多余文件候选数。
 * @param limits 目标阈值。
 * @param confirm 本次跳过数值阈值。
 * @param blocked 扫描产生的全目标删除阻断。
 * @returns 预算和操作跳过码。
 * @throws 不适用；输入已由安全整数累计检查。
 */
export function deletionSafety(
  denominator: number,
  replacements: number,
  extras: number,
  limits: DeleteLimits,
  confirm: boolean,
  blocked: boolean,
): SafetyResult {
  const r = BigInt(replacements) + BigInt(extras);
  const invalidPlan = r > BigInt(denominator);
  if (blocked || invalidPlan)
    return { budget: 0, code: 'DELETE_BLOCKED', invalidPlan };
  if (confirm || !limits.enabled)
    return { budget: null, code: null, invalidPlan: false };
  const count = limits.maxCount === null ? null : BigInt(limits.maxCount);
  const percent =
    limits.maxPercent === null
      ? null
      : (BigInt(limits.maxPercent) * BigInt(denominator)) / 100n;
  const budget =
    count === null
      ? percent
      : percent === null
        ? count
        : count < percent
          ? count
          : percent;
  if (budget === null) throw new Error('Enabled delete limits require a bound');
  return {
    budget: Number(budget),
    code: r > budget ? 'DELETE_LIMIT' : null,
    invalidPlan: false,
  };
}
