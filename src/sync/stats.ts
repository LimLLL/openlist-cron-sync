// 定义预览与执行共用的安全整数统计，不依赖框架或数据库。
/** 规范统计字段；文件计数与逻辑动作计数不得混用。 */
export interface Stats {
  /** sourceFiles，非负安全整数。 */
  sourceFiles: number;
  /** sourceDirectories，非负安全整数。 */
  sourceDirectories: number;
  /** targetFiles，非负安全整数。 */
  targetFiles: number;
  /** unchangedFiles，非负安全整数。 */
  unchangedFiles: number;
  /** filteredFiles，非负安全整数。 */
  filteredFiles: number;
  /** protectedFiles，非负安全整数。 */
  protectedFiles: number;
  /** plannedCreates，非负安全整数。 */
  plannedCreates: number;
  /** plannedReplacements，非负安全整数。 */
  plannedReplacements: number;
  /** plannedExtraDeletes，非负安全整数。 */
  plannedExtraDeletes: number;
  /** plannedDirectoryDeletes，非负安全整数。 */
  plannedDirectoryDeletes: number;
  /** succeededCreates，非负安全整数。 */
  succeededCreates: number;
  /** deletedForReplace，非负安全整数。 */
  deletedForReplace: number;
  /** deletedAsExtra，非负安全整数。 */
  deletedAsExtra: number;
  /** failedOperations，非负安全整数。 */
  failedOperations: number;
  /** unknownOperations，非负安全整数。 */
  unknownOperations: number;
  /** skippedOperations，非负安全整数。 */
  skippedOperations: number;
  /** cancelledOperations，非负安全整数。 */
  cancelledOperations: number;
  /** retryAttempts，非负安全整数。 */
  retryAttempts: number;
  /** plannedBytes，非负安全整数。 */
  plannedBytes: number;
  /** downloadedBytes，非负安全整数。 */
  downloadedBytes: number;
  /** transferredBytes，非负安全整数。 */
  transferredBytes: number;
  /** actualDeletedBytes，非负安全整数。 */
  actualDeletedBytes: number;
}
/** 新建全零统计。
 * @param 不适用。
 * @returns 独立的统计对象。
 * @throws 不适用。
 */
export function emptyStats(): Stats {
  return {
    sourceFiles: 0,
    sourceDirectories: 0,
    targetFiles: 0,
    unchangedFiles: 0,
    filteredFiles: 0,
    protectedFiles: 0,
    plannedCreates: 0,
    plannedReplacements: 0,
    plannedExtraDeletes: 0,
    plannedDirectoryDeletes: 0,
    succeededCreates: 0,
    deletedForReplace: 0,
    deletedAsExtra: 0,
    failedOperations: 0,
    unknownOperations: 0,
    skippedOperations: 0,
    cancelledOperations: 0,
    retryAttempts: 0,
    plannedBytes: 0,
    downloadedBytes: 0,
    transferredBytes: 0,
    actualDeletedBytes: 0,
  };
}
/** 增加计数，溢出时停止整轮计划。
 * @param stats 所属统计。
 * @param key 计数字段。
 * @param value 增量。
 * @returns 不适用。
 * @throws PlanError 聚合超出安全整数。
 */
export function addStat(stats: Stats, key: keyof Stats, value = 1): void {
  const next = stats[key] + value;
  if (!Number.isSafeInteger(next) || next < 0)
    throw new PlanError('RESOURCE_LIMIT');
  stats[key] = next;
}
/** 规划可预期错误，摘要只使用固定原因码。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class PlanError extends Error {
  /** 构造安全错误。
   * @param code Run 错误码。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(readonly code: string) {
    super(code);
  }
}
