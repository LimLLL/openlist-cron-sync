// 从真实配置与运行记录判断引用责任，不建立持久化锁。
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { jobs, jobTargets } from './job-schema.js';
import { runs } from './run-schema.js';
import { operations } from './operation-schema.js';
import { ACTIVE_RUN_STATUSES } from '../runs/run-types.js';
import { ApiError } from '../common/errors.js';

/** 判断 Job 非终态占用，queued 同样占位。
 * @param db 数据库或事务。
 * @param jobId Job ID。
 * @returns 是否被占用。
 * @throws Error 数据库失败。
 */
export function jobBusy(db: BetterSQLite3Database, jobId: string): boolean {
  return (
    db
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.jobId, jobId),
          inArray(runs.status, [...ACTIVE_RUN_STATUSES]),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}
/** 拒绝对正在运行的 Job 修改。
 * @param db 数据库或事务。
 * @param jobId Job ID。
 * @returns 不适用。
 * @throws ApiError JOB_BUSY；Error 数据库失败。
 */
export function assertJobIdle(db: BetterSQLite3Database, jobId: string): void {
  if (jobBusy(db, jobId))
    throw new ApiError(409, 'JOB_BUSY', 'Job has a non-terminal run');
}
/** 判断实例是否被活动配置引用；disabled Job 也属于活动配置。
 * @param db 数据库或事务。
 * @param instanceId 实例 ID。
 * @returns 是否有引用。
 * @throws Error 数据库失败。
 */
export function activeJobReference(
  db: BetterSQLite3Database,
  instanceId: string,
): boolean {
  return (
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          isNull(jobs.archivedAt),
          or(
            eq(jobs.sourceInstanceId, instanceId),
            sql`EXISTS (SELECT 1 FROM ${jobTargets} WHERE ${jobTargets.jobId} = ${jobs.id} AND ${jobTargets.archivedAt} IS NULL AND ${jobTargets.instanceId} = ${instanceId})`,
          ),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}
/** 从固定快照判断非终态 Run 的实例引用，避免联表读取可变 Job。
 * @param db 数据库或事务。
 * @param instanceId 实例 ID。
 * @returns 是否有活动运行引用。
 * @throws Error 数据库失败。
 */
export function activeRunReference(
  db: BetterSQLite3Database,
  instanceId: string,
): boolean {
  return (
    db
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          inArray(runs.status, [...ACTIVE_RUN_STATUSES]),
          sql`EXISTS (SELECT 1 FROM json_each(${runs.config}, '$.instances') AS endpoint WHERE endpoint.key = ${instanceId})`,
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}
/** 统一未决责任：非终态 Run、未解决 unknown 或待清理远程任务。
 * @param db 数据库或事务。
 * @param instanceId 实例 ID。
 * @returns 是否承担责任。
 * @throws Error 数据库失败。
 */
export function hasResponsibility(
  db: BetterSQLite3Database,
  instanceId: string,
): boolean {
  if (activeRunReference(db, instanceId)) return true;
  const endpoint = or(
    eq(operations.sourceInstanceId, instanceId),
    eq(operations.targetInstanceId, instanceId),
  );
  // 两类事实分开查询，分别命中 (status, unknown_until) 与 remote_cleanup_pending 索引，避免扫描全部历史。
  for (const pending of [
    and(eq(operations.status, 'unknown'), isNull(operations.resolutionKind)),
    eq(operations.remoteCleanupPending, true),
  ])
    if (
      db
        .select({ id: operations.id })
        .from(operations)
        .where(and(pending, endpoint))
        .limit(1)
        .get() !== undefined
    )
      return true;
  return false;
}
