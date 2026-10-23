// 对保存和触发共用端点身份、能力与路径重叠校验。
import { eq, isNull, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { instances } from '../database/schema.js';
import type { InstanceRecord } from '../database/schema.js';
import { ApiError } from '../common/errors.js';
import { containsPath, globalPath } from '../openlist/paths.js';
import { supportedVersion } from '../openlist/protocol.js';
import type { Job } from './job-types.js';
import type { InstanceSnapshot } from '../runs/run-types.js';

/** 读取全部实例并验证配置；未测试配置只可保存为 disabled。
 * @param db 数据库或事务。
 * @param job 合并后的 Job。
 * @param requireReady 是否为启用或手动触发。
 * @returns 按实例 ID 去重的配置。
 * @throws ApiError 无效引用、能力缺失或重叠；Error 数据库失败。
 */
export function validateEndpoints(
  db: BetterSQLite3Database,
  job: Job,
  requireReady: boolean,
): Map<string, InstanceRecord> {
  const endpoints = [job.source, ...job.targets];
  const records = new Map<string, InstanceRecord>();
  for (const endpoint of endpoints) {
    if (records.has(endpoint.instanceId)) continue;
    const row = db
      .select()
      .from(instances)
      .where(
        and(
          eq(instances.id, endpoint.instanceId),
          isNull(instances.archivedAt),
        ),
      )
      .get();
    if (!row)
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Endpoint instance is unavailable',
      );
    if (
      requireReady &&
      (!row.secretEnc ||
        row.accountBasePath === null ||
        row.accountUsername === null ||
        row.accountRole === null ||
        row.accountPermissions === null ||
        row.lastTestAt === null ||
        row.openlistVersion === null)
    )
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Endpoint must be tested and have credentials',
      );
    if (
      requireReady &&
      row.openlistVersion !== null &&
      !supportedVersion(row.openlistVersion)
    )
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Endpoint version is unsupported',
        [{ field: 'instanceId', reason: 'OPENLIST_VERSION_UNSUPPORTED' }],
      );
    records.set(row.id, row);
  }
  for (const [index, target] of job.targets.entries()) {
    const row = records.get(target.instanceId);
    if (
      requireReady &&
      target.createMode === 'relay' &&
      row?.multipartEnabled !== true
    )
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Relay target requires multipart support',
        [
          {
            field: `targets[${index}].instanceId`,
            reason: 'MULTIPART_DISABLED',
          },
        ],
      );
  }
  for (let i = 0; i < endpoints.length; i++)
    for (let j = i + 1; j < endpoints.length; j++) {
      const a = endpoints[i];
      const b = endpoints[j];
      const ai = records.get(a.instanceId);
      const bi = records.get(b.instanceId);
      if (!ai || !bi) throw new Error('Endpoint configuration missing');
      const same = a.instanceId === b.instanceId;
      if (
        !same &&
        (ai.baseUrl !== bi.baseUrl ||
          ai.accountBasePath === null ||
          bi.accountBasePath === null)
      )
        continue;
      const ap = same ? a.path : globalPath(ai.accountBasePath ?? '/', a.path);
      const bp = same ? b.path : globalPath(bi.accountBasePath ?? '/', b.path);
      if (containsPath(ap, bp) || containsPath(bp, ap))
        throw new ApiError(409, 'PATH_OVERLAP', 'Job endpoints overlap');
    }
  return records;
}
/** 固定已验证的实例公开值。
 * @param row 实例配置。
 * @returns 不含凭据和认证缓存的快照。
 * @throws Error 身份未核实。
 */
export function instanceSnapshot(row: InstanceRecord): InstanceSnapshot {
  if (
    row.accountBasePath === null ||
    row.accountRole === null ||
    row.accountPermissions === null
  )
    throw new Error('Untested snapshot endpoint');
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    authMode: row.authMode,
    username: row.username,
    accountUsername: row.accountUsername,
    accountBasePath: row.accountBasePath,
    accountRole: row.accountRole,
    accountPermissions: row.accountPermissions,
    limits: {
      maxApiConcurrency: row.maxApiConcurrency,
      apiRequestsPerSecond: row.apiRequestsPerSecond,
    },
    downloadMode: row.downloadMode,
  };
}
