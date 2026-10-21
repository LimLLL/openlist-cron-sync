// 运行页面共用的派生值：耗时、快照中的任务名与目标标签、统计字段判断。
import enRuns from '../../i18n/locales/en/runs';
import { ACTIVE_RUN_STATUSES } from './run-contract';
import type { RunDetail, RunTargetView, RunView } from './run-contract';

/** 计算运行耗时（秒）；进行中按当前时间计，尚未开始返回 null。
 * @param run 运行视图。
 * @param now 当前时间毫秒，便于测试注入。
 * @returns 秒数或 null。
 * @throws 不适用。
 */
export function runDurationSeconds(run: RunView, now = Date.now()): number | null {
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

/** 读取配置快照中的任务名称；快照缺失或格式异常时返回 null。
 * @param detail 运行详情。
 * @returns 任务名或 null。
 * @throws 不适用。
 */
export function snapshotJobName(detail: RunDetail): string | null {
  const name = detail.config.job.name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

/** 目标在快照中的展示信息。 */
export interface TargetLabel {
  /** 实例名称；缺失时为 null。 */
  instanceName: string | null;
  /** 目标路径；缺失时为 null。 */
  path: string | null;
  /** 同步模式；未知值为 null。 */
  mode: 'incremental' | 'mirror' | null;
  /** 接受 Run 时固定的文件创建方式。 */
  createMode: RunTargetView['config']['target']['createMode'];
}

/** 从运行目标快照中提取实例名、路径、同步模式与创建方式。
 * @param target 运行目标。
 * @returns 展示信息。
 * @throws 不适用。
 */
export function targetLabel(target: RunTargetView): TargetLabel {
  const { instance, target: config } = target.config;
  const mode = config.mode === 'incremental' || config.mode === 'mirror' ? config.mode : null;
  return {
    instanceName: typeof instance.name === 'string' ? instance.name : null,
    path: typeof config.path === 'string' ? config.path : null,
    mode,
    createMode: config.createMode,
  };
}

/** 判断统计字段是否有翻译；后端新增字段时回退为拆分后的字段名。
 * @param key 统计字段名。
 * @returns 是否为已知统计字段。
 * @throws 不适用。
 */
export function isStatKey(key: string): key is keyof typeof enRuns.detail.stats {
  return Object.hasOwn(enRuns.detail.stats, key);
}

/** 判断统计字段是否表示字节量。
 * @param key 统计字段名。
 * @returns 是否为字节字段。
 * @throws 不适用。
 */
export function isByteStat(key: string): boolean {
  return /bytes/i.test(key);
}
