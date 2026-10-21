// 读取配置记录并投影公共 Job，不向 API 暴露数据库实体。
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { jobs, jobTargets } from './job-schema.js';
import type { JobRecord, TargetRecord } from './job-schema.js';
import type { Job } from '../jobs/job-types.js';
import { ApiError } from '../common/errors.js';

/** 获取未归档 Job 及活动目标。
 * @param db 数据库或事务。
 * @param id Job ID。
 * @returns 原始配置记录。
 * @throws ApiError 未找到；Error 数据库失败。
 */
export function jobRecords(
  db: BetterSQLite3Database,
  id: string,
): { row: JobRecord; targets: TargetRecord[] } {
  const row = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), isNull(jobs.archivedAt)))
    .get();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
  const targets = db
    .select()
    .from(jobTargets)
    .where(and(eq(jobTargets.jobId, id), isNull(jobTargets.archivedAt)))
    .orderBy(asc(jobTargets.position))
    .all();
  return { row, targets };
}
/** 转换持久化毫秒时间。
 * @param value 毫秒或 null。
 * @returns UTC 字符串或 null。
 * @throws RangeError 时间不合法。
 */
export function time(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
/** 构造完整公开 Job。
 * @param row Job 记录。
 * @param targets 对应目标列表。
 * @returns 不含秘密的配置。
 * @throws RangeError 时间不合法。
 */
export function jobView(row: JobRecord, targets: TargetRecord[]): Job {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    source: {
      instanceId: row.sourceInstanceId,
      path: row.sourcePath,
      refresh: row.sourceRefresh,
      hasPassword: row.sourcePasswordEnc !== null,
    },
    targets: targets.map(
      /** 将活动目标记录投影为公开 Target。
       * @param t 当前目标记录。
       * @returns 不含密码密文的公开目标。
       * @throws 不适用。
       */
      (t) => ({
        id: t.id,
        position: t.position,
        instanceId: t.instanceId,
        path: t.path,
        hasPassword: t.passwordEnc !== null,
        refresh: t.refresh,
        mode: t.mode,
        createMode: t.createMode,
        deleteLimits: {
          enabled: t.deleteLimitsEnabled,
          maxCount: t.maxDeleteCount,
          maxPercent: t.maxDeletePercent,
        },
      }),
    ),
    cron: row.cron,
    timezone: row.timezone,
    filters: {
      include: row.includeGlobs,
      exclude: row.excludeGlobs,
      minSizeBytes: row.minSizeBytes,
      maxSizeBytes: row.maxSizeBytes,
    },
    allowEmptySource: row.allowEmptySource,
    syncEmptyDirs: row.syncEmptyDirs,
    relayBandwidthLimit: row.relayBandwidthLimit,
    timeoutSeconds: row.timeoutSeconds,
    notificationChannelIds: [],
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    archivedAt: time(row.archivedAt),
  };
}
