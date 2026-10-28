// 运行页面共用的派生值：耗时、快照任务名、目标标签、统计分组与汇总计数；只读取后端事实，不推算百分比。
import { intlLocale } from '../../i18n';
import { ACTIVE_RUN_STATUSES } from './run-contract';
import type {
  RunDetail,
  RunStats,
  RunTargetView,
  RunView,
} from './run-contract';

/** 统计分组：扫描、计划、结果、字节；未列出的键归入“其他”。 */
export const STAT_GROUPS = {
  scan: [
    'sourceFiles',
    'sourceDirectories',
    'targetFiles',
    'unchangedFiles',
    'filteredFiles',
    'protectedFiles',
  ],
  plan: [
    'plannedCreates',
    'plannedReplacements',
    'plannedExtraDeletes',
    'plannedDirectoryDeletes',
    'plannedBytes',
  ],
  result: [
    'succeededCreates',
    'deletedForReplace',
    'deletedAsExtra',
    'failedOperations',
    'unknownOperations',
    'skippedOperations',
    'cancelledOperations',
    'retryAttempts',
  ],
  bytes: ['downloadedBytes', 'transferredBytes', 'actualDeletedBytes'],
} as const;

/** 有本地化标签的统计键。 */
export type StatKey = (typeof STAT_GROUPS)[keyof typeof STAT_GROUPS][number];

const KNOWN_STATS: ReadonlySet<string> = new Set(
  Object.values(STAT_GROUPS).flat(),
);

/** 判断统计键是否有本地化标签。
 * @param key 统计键。
 * @returns 是否为已知键。
 * @throws 不适用。
 */
export function isStatKey(key: string): key is StatKey {
  return KNOWN_STATS.has(key);
}

/** 判断统计值是否为字节数。
 * @param key 统计键。
 * @returns 是否按字节格式化。
 * @throws 不适用。
 */
export function isByteStat(key: string): boolean {
  return /bytes/i.test(key);
}

/** 把未知的驼峰统计键拆成可读文字，例如 fooBarCount → “foo bar count”。
 * @param key 统计键。
 * @returns 可读标签。
 * @throws 不适用。
 */
export function readableKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

/** 读取统计值，缺失视为 0（后端只在有值时一定返回同一组键）。
 * @param stats 统计对象。
 * @param key 统计键。
 * @returns 数值。
 * @throws 不适用。
 */
export function stat(stats: RunStats, key: string): number {
  return stats[key] ?? 0;
}

/** 运行或目标的汇总计数；“已完成/计划”两两同口径，可直接对比。 */
export interface RunCounts {
  /** 已新建文件数（含替换时写入的新文件）。 */
  created: number;
  /** 计划新建文件数（含替换所需的新建）。 */
  plannedCreates: number;
  /** 已完成替换前删除旧文件的数量。 */
  replaced: number;
  /** 计划替换数（是计划新建的子集）。 */
  plannedReplacements: number;
  /** 已删除的目标端多余文件数。 */
  deleted: number;
  /** 计划删除的目标端多余文件数。 */
  plannedDeletes: number;
  /** 计划删除的多余空目录数；后端不统计已完成的空目录删除，只单独展示。 */
  plannedDirectoryDeletes: number;
  /** 已传输字节（含重试）。 */
  transferred: number;
  /** 计划字节。 */
  plannedBytes: number;
  /** 失败操作数。 */
  failed: number;
  /** 结果未知的操作数。 */
  unknown: number;
}

/** 从统计对象汇总新建、替换、删除与字节计数，全站统一使用这一口径。
 * @param stats 运行或目标统计。
 * @returns 汇总计数。
 * @throws 不适用。
 */
export function runCounts(stats: RunStats): RunCounts {
  return {
    created: stat(stats, 'succeededCreates'),
    plannedCreates: stat(stats, 'plannedCreates'),
    replaced: stat(stats, 'deletedForReplace'),
    plannedReplacements: stat(stats, 'plannedReplacements'),
    deleted: stat(stats, 'deletedAsExtra'),
    plannedDeletes: stat(stats, 'plannedExtraDeletes'),
    plannedDirectoryDeletes: stat(stats, 'plannedDirectoryDeletes'),
    transferred: stat(stats, 'transferredBytes'),
    plannedBytes: stat(stats, 'plannedBytes'),
    failed: stat(stats, 'failedOperations'),
    unknown: stat(stats, 'unknownOperations'),
  };
}

/** 判断计划中是否有改动（新建/替换、删除多余文件或空目录）；目录创建不计入统计。
 * @param stats 运行统计。
 * @returns 是否有计划的改动。
 * @throws 不适用。
 */
export function hasPlannedWork(stats: RunStats): boolean {
  const counts = runCounts(stats);
  return (
    counts.plannedCreates +
      counts.plannedDeletes +
      counts.plannedDirectoryDeletes >
    0
  );
}

/** 按界面语言格式化整数计数。
 * @param value 计数。
 * @returns 带千分位的文字。
 * @throws 不适用。
 */
export function formatCount(value: number): string {
  return new Intl.NumberFormat(intlLocale()).format(value);
}

/** 计算运行耗时（秒）；进行中按当前时间计，尚未开始返回 null。
 * @param run 运行视图。
 * @param now 当前时间毫秒，便于测试注入。
 * @returns 秒数或 null。
 * @throws 不适用。
 */
export function runDurationSeconds(
  run: Pick<RunView, 'startedAt' | 'endedAt' | 'status'>,
  now = Date.now(),
): number | null {
  if (!run.startedAt) return null;
  const start = Date.parse(run.startedAt);
  const end = run.endedAt
    ? Date.parse(run.endedAt)
    : ACTIVE_RUN_STATUSES.has(run.status)
      ? now
      : null;
  if (end === null || Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

/** 读取配置快照中的任务名称；快照缺失或为空时返回 null。
 * @param detail 运行详情。
 * @returns 任务名或 null。
 * @throws 不适用。
 */
export function snapshotJobName(detail: RunDetail): string | null {
  const name = detail.config.job.name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

/** 运行目标的展示标签，全部来自运行快照而非当前任务配置。 */
export interface TargetLabel {
  /** 目标路径；快照异常时为 null。 */
  path: string | null;
  /** 同步模式；快照异常时为 null。 */
  mode: 'incremental' | 'mirror' | null;
  /** 创建方式。 */
  createMode: RunTargetView['config']['target']['createMode'];
}

/** 从运行目标快照读取路径、模式与创建方式。
 * @param target 运行目标。
 * @returns 展示标签。
 * @throws 不适用。
 */
export function targetLabel(target: RunTargetView): TargetLabel {
  const config = target.config.target;
  const mode =
    config.mode === 'incremental' || config.mode === 'mirror'
      ? config.mode
      : null;
  return {
    path: typeof config.path === 'string' ? config.path : null,
    mode,
    createMode: config.createMode,
  };
}
