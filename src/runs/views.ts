// 显式投影运行、操作与诊断响应，任何 ENC 或下载秘密均不进入 API。
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
 * @returns RunTargetView。
 * @throws 不适用。
 */
export function targetView(row: RunTargetRecord) {
  return {
    id: row.id,
    targetId: row.targetId,
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
/** 投影完整规范 Operation 形状，预览不会有远程任务或 session。
 * @param row Operation 记录。
 * @returns OperationView。
 * @throws RangeError 非法时间；Error session 数据不完整。
 */
export function operationView(row: OperationRecord) {
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
    sourcePath: row.sourcePath,
    targetInstanceId: row.targetInstanceId,
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
