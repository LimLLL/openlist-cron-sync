// 显式投影运行、操作与诊断响应，任何 ENC 或下载秘密均不进入 API。
import { inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { instances } from '../database/schema.js';
import { runs } from '../database/run-schema.js';
import type { RunRecord, RunTargetRecord } from '../database/run-schema.js';
import type { OperationRecord } from '../database/operation-schema.js';
import { time } from '../database/job-records.js';

/** 投影 Run 基础字段。
 * @param row 数据库记录。
 * @returns RunView 公共对象。
 * @throws RangeError 非法数据库时间。
 */
export function runView(row: RunRecord) {
  return {
    id: row.id,
    jobId: row.jobId,
    trigger: row.trigger,
    scheduledAt: time(row.scheduledAt),
    dryRun: row.dryRun,
    confirmDeletes: row.confirmDeletes,
    status: row.status,
    stats: row.stats,
    stopReason: row.stopReason,
    error:
      row.errorCode === null
        ? null
        : { code: row.errorCode, message: row.errorMessage ?? row.errorCode },
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    startedAt: time(row.startedAt),
    scanCompletedAt: time(row.scanCompletedAt),
    endedAt: time(row.endedAt),
    deadlineAt: time(row.deadlineAt),
    queueDeadlineAt: new Date(row.queueDeadlineAt).toISOString(),
    cancelRequestedAt: time(row.cancelRequestedAt),
    recoveryDeadlineAt: time(row.recoveryDeadlineAt),
  };
}
/** 投影每目标扫描与预算事实。
 * @param row Run Target 记录。
 * @param instanceName 已解析的实例名称或实例短ID。
 * @returns RunTargetView。
 * @throws 不适用。
 */
export function targetView(row: RunTargetRecord, instanceName: string) {
  return {
    id: row.id,
    targetId: row.targetId,
    instanceName,
    config: row.config,
    stats: row.stats,
    sourceComplete: row.sourceComplete,
    targetComplete: row.targetComplete,
    suspect: row.suspect,
    deleteBlocked: row.deleteBlocked,
    extrasBlocked: row.extrasBlocked,
    blockReasons: row.blockReasons,
    observedTargetFileCount: row.observedTargetFileCount,
    plannedReplaceCount: row.plannedReplaceCount,
    plannedExtraCount: row.plannedExtraCount,
    deleteBudgetCount: row.deleteBudgetCount,
  };
}

/** 操作两端的可展示实例名称。 */
export interface OperationInstanceLabels {
  /** 源实例名称；没有源的操作为null。 */
  sourceInstanceName: string | null;
  /** 目标实例名称。 */
  targetInstanceName: string;
}
/** 批量读取实例当前名称，包含已归档实例。
 * @param db 数据库。
 * @param ids Instance ID，可重复。
 * @returns ID到当前名称的映射；已不存在的实例缺省。
 * @throws Error 数据库读取失败。
 */
export function currentInstanceNames(
  db: BetterSQLite3Database,
  ids: readonly string[],
): Map<string, string> {
  if (!ids.length) return new Map();
  return new Map(
    db
      .select({ id: instances.id, name: instances.name })
      .from(instances)
      .where(inArray(instances.id, [...new Set(ids)]))
      .all()
      .map(
        /** 转为ID与名称的映射条目。
         * @param row 实例名称行。
         * @returns 映射条目。
         * @throws 不适用。
         */
        (row) => [row.id, row.name],
      ),
  );
}
/** 依次取Run快照中的冻结名称、实例当前名称、实例ID前8位作为展示名。
 * @param id Instance ID，不能用Target ID替代。
 * @param frozen 快照中的冻结名称。
 * @param current 实例当前名称。
 * @returns 非空展示名称。
 * @throws 不适用。
 */
export function instanceLabel(
  id: string,
  frozen: string | undefined,
  current: ReadonlyMap<string, string>,
): string {
  return frozen || current.get(id) || id.slice(0, 8);
}
/** 为一页操作解析两端实例名并投影公开字段，只读取涉及的Run快照与实例。
 * @param db 数据库。
 * @param rows 当前页操作记录。
 * @returns OperationView数组，顺序不变。
 * @throws RangeError 非法时间；Error 数据库失败或session数据不完整。
 */
export function operationViews(
  db: BetterSQLite3Database,
  rows: readonly OperationRecord[],
) {
  if (!rows.length) return [];
  const snapshots = new Map(
    db
      .select({ id: runs.id, config: runs.config })
      .from(runs)
      .where(
        inArray(runs.id, [
          ...new Set(
            rows.map(
              /** 读取操作所属Run。
               * @param row 操作记录。
               * @returns Run ID。
               * @throws 不适用。
               */
              (row) => row.runId,
            ),
          ),
        ]),
      )
      .all()
      .map(
        /** 转为Run ID与快照实例表的映射条目。
         * @param row Run快照行。
         * @returns 映射条目。
         * @throws 不适用。
         */
        (row) => [row.id, row.config.instances],
      ),
  );
  const current = currentInstanceNames(
    db,
    rows.flatMap(
      /** 收集一条操作涉及的实例。
       * @param row 操作记录。
       * @returns 源与目标Instance ID。
       * @throws 不适用。
       */
      (row) =>
        row.sourceInstanceId
          ? [row.sourceInstanceId, row.targetInstanceId]
          : [row.targetInstanceId],
    ),
  );
  return rows.map(
    /** 按该操作所属Run的快照解析名称并投影。
     * @param row 操作记录。
     * @returns OperationView。
     * @throws RangeError 非法时间；Error session数据不完整。
     */
    (row) => {
      const frozen = snapshots.get(row.runId);
      return operationView(row, {
        sourceInstanceName:
          row.sourceInstanceId === null
            ? null
            : instanceLabel(
                row.sourceInstanceId,
                frozen?.[row.sourceInstanceId]?.name,
                current,
              ),
        targetInstanceName: instanceLabel(
          row.targetInstanceId,
          frozen?.[row.targetInstanceId]?.name,
          current,
        ),
      });
    },
  );
}
/** 投影完整规范 Operation 形状，预览不会有远程任务或 session。
 * @param row Operation 记录。
 * @param labels 已解析的源/目标实例名称。
 * @returns OperationView。
 * @throws RangeError 非法时间；Error session 数据不完整。
 */
export function operationView(
  row: OperationRecord,
  labels: OperationInstanceLabels,
) {
  if (row.multipartUploadId !== null && row.multipartChunkSize === null)
    throw new Error('Incomplete multipart record');
  return {
    id: row.id,
    runId: row.runId,
    runTargetId: row.runTargetId,
    seq: row.seq,
    action: row.action,
    method: row.method,
    reason: row.reason,
    status: row.status,
    sourceInstanceId: row.sourceInstanceId,
    sourceInstanceName: labels.sourceInstanceName,
    sourcePath: row.sourcePath,
    targetInstanceId: row.targetInstanceId,
    targetInstanceName: labels.targetInstanceName,
    targetPath: row.targetPath,
    isDir: row.isDir,
    expectedSourceSize: row.expectedSourceSize,
    expectedTargetSize: row.expectedTargetSize,
    affectedFileCount: row.affectedFileCount,
    affectedBytes: row.affectedBytes,
    retryOf: row.retryOf,
    causedByOperationId: row.causedByOperationId,
    attemptNo: row.attemptNo,
    task:
      row.openlistTaskId === null
        ? null
        : { id: row.openlistTaskId, state: row.remoteState },
    multipart:
      row.multipartUploadId === null
        ? null
        : {
            uploadId: row.multipartUploadId,
            chunkSize: row.multipartChunkSize,
            state: row.multipartState,
            attempt: row.multipartAttempt,
            sourceStreamCompletedAt: time(row.sourceStreamCompletedAt),
          },
    bytesDownloaded: row.bytesDownloaded,
    bytesTransferred: row.bytesTransferred,
    error:
      row.errorCode === null
        ? null
        : { code: row.errorCode, message: row.errorMessage ?? row.errorCode },
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    submittedAt: time(row.submittedAt),
    endedAt: time(row.endedAt),
    unknownSince: time(row.unknownSince),
    unknownUntil: time(row.unknownUntil),
    quarantineReleasedAt: time(row.quarantineReleasedAt),
    quarantineReleaseReason: row.quarantineReleaseReason,
    reobservedAt: time(row.reobservedAt),
    resolution:
      row.resolutionKind === null
        ? null
        : {
            kind: row.resolutionKind,
            note: row.resolutionNote,
            resolvedAt: time(row.resolvedAt),
            runId: row.resolvedByRunId,
          },
  };
}
