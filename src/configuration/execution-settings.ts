// 固定运行快照的完整参数映射，不读取尚未消费的 worker 或维护配置。
import { integerSetting, invalidConfig } from './validation.js';
import type { Environment } from './validation.js';

/** 已校验的运行参数；字段单位由名称标明。 */
export interface ExecutionSettings {
  /** 排队期限，秒。 */
  queueTimeoutSeconds: number;
  /** 建连期限，毫秒。 */
  connectTimeoutMs: number;
  /** 普通请求每次尝试的期限，含连接及响应、不含间隔/认证等待与退避，毫秒。 */
  apiTimeoutMs: number;
  /** 任务轮询间隔，毫秒。 */
  taskPollMs: number;
  /** 读取总尝试数。 */
  retryMaxAttempts: number;
  /** 退避基数，毫秒。 */
  retryBaseMs: number;
  /** 退避上限，毫秒。 */
  retryMaxMs: number;
  /** 认证冷却，秒。 */
  authCooldownSeconds: number;
  /** 删除确认期限，秒。 */
  deleteConfirmTimeoutSeconds: number;
  /** 删除确认间隔，毫秒。 */
  deleteConfirmIntervalMs: number;
  /** relay 空闲期限，秒。 */
  relayIdleTimeoutSeconds: number;
  /** relay 总期限，秒。 */
  relayTotalTimeoutSeconds: number;
  /** 隔离期限，秒。 */
  quarantineSeconds: number;
  /** 恢复期限，秒。 */
  recoveryTimeoutSeconds: number;
  /** 取消宽限，秒。 */
  cancelGraceSeconds: number;
  /** endpoint 根深度为 0，允许的最大子目录深度。 */
  scanMaxDepth: number;
  /** 原始单目录条目上限。 */
  scanMaxDirectoryEntries: number;
  /** 上游 JSON 字节上限。 */
  maxJsonBytes: number;
  /** Run 操作数上限。 */
  maxOperationsPerRun: number;
  /** 去重后问题数上限。 */
  maxScanIssuesPerRun: number;
  /** 单批计划事务的记录数。 */
  planBatchSize: number;
}

/** 读取全部快照字段，未实现的执行器只保存对应值。
 * @param env 当前应用环境。
 * @returns 完整且无 null 的参数。
 * @throws StartupError 非法配置。
 */
export function executionSettings(env: Environment): ExecutionSettings {
  const settings: ExecutionSettings = {
    queueTimeoutSeconds: integerSetting(
      env,
      'QUEUE_TIMEOUT_SECONDS',
      3600,
      60,
      86400,
    ),
    connectTimeoutMs: integerSetting(
      env,
      'OPENLIST_CONNECT_TIMEOUT_MS',
      10000,
      1000,
      120000,
    ),
    apiTimeoutMs: integerSetting(
      env,
      'OPENLIST_API_TIMEOUT_MS',
      30000,
      1000,
      300000,
    ),
    taskPollMs: integerSetting(env, 'OPENLIST_TASK_POLL_MS', 3000, 500, 60000),
    retryMaxAttempts: integerSetting(env, 'RETRY_MAX_ATTEMPTS', 3, 1, 10),
    retryBaseMs: integerSetting(env, 'RETRY_BASE_MS', 1000, 100, 60000),
    retryMaxMs: integerSetting(env, 'RETRY_MAX_MS', 30000, 100, 300000),
    authCooldownSeconds: integerSetting(
      env,
      'OPENLIST_AUTH_COOLDOWN_SECONDS',
      600,
      600,
      86400,
    ),
    deleteConfirmTimeoutSeconds: integerSetting(
      env,
      'DELETE_CONFIRM_TIMEOUT_SECONDS',
      60,
      5,
      600,
    ),
    deleteConfirmIntervalMs: integerSetting(
      env,
      'DELETE_CONFIRM_INTERVAL_MS',
      2000,
      500,
      30000,
    ),
    relayIdleTimeoutSeconds: integerSetting(
      env,
      'RELAY_IDLE_TIMEOUT_SECONDS',
      60,
      5,
      600,
    ),
    relayTotalTimeoutSeconds: integerSetting(
      env,
      'RELAY_TOTAL_TIMEOUT_SECONDS',
      21600,
      60,
      604800,
    ),
    quarantineSeconds: integerSetting(
      env,
      'QUARANTINE_SECONDS',
      86400,
      2100,
      2592000,
    ),
    recoveryTimeoutSeconds: integerSetting(
      env,
      'RECOVERY_TIMEOUT_SECONDS',
      600,
      10,
      86400,
    ),
    cancelGraceSeconds: integerSetting(env, 'CANCEL_GRACE_SECONDS', 60, 1, 600),
    scanMaxDepth: integerSetting(env, 'SCAN_MAX_DEPTH', 128, 1, 1024),
    scanMaxDirectoryEntries: integerSetting(
      env,
      'SCAN_MAX_DIRECTORY_ENTRIES',
      100000,
      1,
      1000000,
    ),
    maxJsonBytes: integerSetting(
      env,
      'OPENLIST_MAX_JSON_BYTES',
      33554432,
      1024,
      268435456,
    ),
    maxOperationsPerRun: integerSetting(
      env,
      'MAX_OPERATIONS_PER_RUN',
      1000000,
      1,
      10000000,
    ),
    maxScanIssuesPerRun: integerSetting(
      env,
      'MAX_SCAN_ISSUES_PER_RUN',
      10000,
      1,
      100000,
    ),
    planBatchSize: integerSetting(env, 'PLAN_BATCH_SIZE', 500, 1, 5000),
  };
  if (settings.retryMaxMs < settings.retryBaseMs) invalidConfig('RETRY_MAX_MS');
  return settings;
}
