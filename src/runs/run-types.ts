// 定义持久化运行状态与公开配置快照，不包含认证秘密。
import type { ExecutionSettings } from '../configuration/execution-settings.js';
import type { Job } from '../jobs/job-types.js';

export const RUN_STATUSES = [
  'queued',
  'scanning',
  'planned',
  'executing',
  'cancelling',
  'recovering',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export const ACTIVE_RUN_STATUSES = [
  'queued',
  'scanning',
  'planned',
  'executing',
  'cancelling',
  'recovering',
] as const;
export const OPERATION_STATUSES = [
  'pending',
  'submitting',
  'submitted',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'unknown',
  'cancelled',
] as const;
/** 规范 Run 状态。 */
export type RunStatus = (typeof RUN_STATUSES)[number];
/** 不含 secret、认证状态或测试错误的实例快照。 */
export interface InstanceSnapshot {
  /** 实例 ID。 */
  id: string;
  /** 当时名称。 */
  name: string;
  /** 规范化地址。 */
  baseUrl: string;
  /** 认证方式。 */
  authMode: 'token' | 'password';
  /** password 配置用户名。 */
  username: string | null;
  /** 已核实账号用户名。 */
  accountUsername: string | null;
  /** 已核实账号全局根。 */
  accountBasePath: string;
  /** 已核实角色。 */
  accountRole: number;
  /** 已核实权限位图。 */
  accountPermissions: number;
  /** 实例资源限制。 */
  limits: {
    /** API 并发数。 */
    maxApiConcurrency: number;
    /** 每秒 API 请求数。 */
    apiRequestsPerSecond: number;
  };
  /** 下载模式。 */
  downloadMode: 'd' | 'p';
}
/** snapshotVersion=1 的完整固定形状。 */
export interface RunConfig {
  /** 固定版本。 */
  snapshotVersion: 1;
  /** 接受请求时的完整 Job。 */
  job: Job;
  /** 按 ID 去重的实例公共配置。 */
  instances: Record<string, InstanceSnapshot>;
  /** 全部有效执行参数。 */
  settings: ExecutionSettings;
}
