// 定义规范化 Job 公共值与内部路径密码，供配置及纯规划共享。
/** 目录端点公共值。 */
export interface Endpoint {
  /** 实例 UUID。 */
  instanceId: string;
  /** 账号内绝对目录。 */
  path: string;
  /** 是否有路径密码，不含密码内容。 */
  hasPassword: boolean;
  /** 普通扫描是否刷新。 */
  refresh: boolean;
}
/** 删除阈值，null 仅禁用对应数值项。 */
export interface DeleteLimits {
  /** 是否启用数值阈值。 */
  enabled: boolean;
  /** 最大文件数，含边界。 */
  maxCount: number | null;
  /** 最大百分比，整数。 */
  maxPercent: number | null;
}
/** 完整过滤配置。 */
export interface Filters {
  /** 任意匹配即包含，空数组表示全部文件。 */
  include: string[];
  /** 优先排除；目录匹配时剪枝。 */
  exclude: string[];
  /** 最小字节数，null 不限制。 */
  minSizeBytes: number | null;
  /** 最大字节数，null 不限制。 */
  maxSizeBytes: number | null;
}
/** 稳定标识的完整目标。 */
export interface Target extends Endpoint {
  /** 稳定 UUID，归档后不复用。 */
  id: string;
  /** 当前目标顺序，从 0 起。 */
  position: number;
  /** 每目标模式。 */
  mode: 'incremental' | 'mirror';
  /** 此目标的文件创建方式；默认 relay。 */
  createMode: 'relay' | 'server_copy';
  /** 此目标同时处理的文件或远程复制任务数；0 不限。 */
  concurrentFiles: number;
  /** 每个 relay 文件同时发送的分片数。 */
  chunkConcurrency: number;
  /** 每目标删除阈值。 */
  deleteLimits: DeleteLimits;
}
/** Job 完整公共响应，也是运行快照中的 Job 形状。 */
export interface Job {
  /** UUID。 */
  id: string;
  /** 展示名称。 */
  name: string;
  /** 源目录。 */
  source: Endpoint;
  /** 按 position 排序的成员目标；归档 Job 为其最终成员集合。 */
  targets: Target[];
  /** cron启用值；disabled仍允许手动执行。 */
  enabled: boolean;
  /** 五段 cron；null 为手动。 */
  cron: string | null;
  /** IANA 时区。 */
  timezone: string;
  /** 完整过滤值。 */
  filters: Filters;
  /** 是否允许完整有效空源删除。 */
  allowEmptySource: boolean;
  /** 是否同步目录结构。 */
  syncEmptyDirs: boolean;
  /** 同时从源读取的 relay 文件数；0 不限。 */
  sourceDownloadConcurrency: number;
  /** 此 Job 所有 relay Target 的聚合上传 bytes/s；0 不限。 */
  relayBandwidthLimit: number;
  /** 失败后的重试次数；null 继承进程默认尝试次数。 */
  retryCount: number | null;
  /** 从扫描开始计的秒数。 */
  timeoutSeconds: number;
  /** 通知随M7接入，当前固定为空。 */
  notificationChannelIds: string[];
  /** 创建 UTC 时间。 */
  createdAt: string;
  /** 更新 UTC 时间。 */
  updatedAt: string;
  /** 归档 UTC 时间，未归档为 null。 */
  archivedAt: string | null;
}
/** 仅内部使用的路径密码快照。 */
export interface PathSecrets {
  /** 源密码；无密码为 null。 */
  sourcePassword: string | null;
  /** 按稳定目标 ID 存储的密码。 */
  targetPasswords: Record<string, string | null>;
}
