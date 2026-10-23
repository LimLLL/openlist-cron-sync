// 定义并校验操作公开响应，保持与后端字段边界一致。
import { ApiError, isRecord } from '../../lib/api-client';
import type { Page } from '../../lib/parsers';
import {
  parsePage,
  expectString,
  expectNumber,
  expectBoolean,
  nullableString,
  nullableNumber,
  expectEnum,
  expectRecord,
  parseDiagnostic,
} from '../../lib/parsers';

/** 操作生命周期状态。 */
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

/** 操作状态类型。 */
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

/** 操作解决结果。 */
export interface Resolution {
  /** 解决方式。 */
  kind: 'observed' | 'superseded' | 'abandoned';
  /** 解决备注。 */
  note: string | null;
  /** 解决时间。 */
  resolvedAt: string;
  /** 解决者 Run UUID。 */
  runId: string | null;
}

/** 操作完整视图。 */
export interface OperationView {
  /** 操作 UUID。 */
  id: string;
  /** 所属 Run UUID。 */
  runId: string;
  /** 所属 Run Target UUID。 */
  runTargetId: string;
  /** Run 内序号。 */
  seq: number;
  /** 逻辑动作。 */
  action: 'mkdir' | 'create' | 'delete';
  /** 执行方法。 */
  method: 'mkdir' | 'relay' | 'server_copy' | 'remove';
  /** 触发原因。 */
  reason: 'prepare' | 'new' | 'replace' | 'extra' | 'retry_cleanup';
  /** 当前状态。 */
  status: OperationStatus;
  /** 源实例 UUID。 */
  sourceInstanceId: string | null;
  /** 源实例名称；没有源端时为 null。 */
  sourceInstanceName: string | null;
  /** 源路径。 */
  sourcePath: string | null;
  /** 目标实例 UUID。 */
  targetInstanceId: string;
  /** 目标实例名称：快照名，其次当前名，最后为实例 ID 前 8 位。 */
  targetInstanceName: string;
  /** 目标路径。 */
  targetPath: string;
  /** 是否目录。 */
  isDir: boolean;
  /** 预期源大小。 */
  expectedSourceSize: number | null;
  /** 预期目标大小。 */
  expectedTargetSize: number | null;
  /** 影响文件数。 */
  affectedFileCount: number;
  /** 影响字节数。 */
  affectedBytes: number;
  /** 重试的源操作 UUID。 */
  retryOf: string | null;
  /** 因果源操作 UUID。 */
  causedByOperationId: string | null;
  /** 尝试序号。 */
  attemptNo: number;
  /** 远程任务。 */
  task: { id: string; state: number | null } | null;
  /** 分片上传。 */
  multipart: {
    uploadId: string;
    chunkSize: number;
    state: string | null;
    attempt: number | null;
    sourceStreamCompletedAt: string | null;
  } | null;
  /** 已下载字节。 */
  bytesDownloaded: number;
  /** 已传输字节。 */
  bytesTransferred: number;
  /** 结构化错误。 */
  error: { code: string; message: string } | null;
  /** 创建时间。 */
  createdAt: string;
  /** 更新时间。 */
  updatedAt: string;
  /** 提交时间。 */
  submittedAt: string | null;
  /** 结束时间。 */
  endedAt: string | null;
  /** unknown 开始时间。 */
  unknownSince: string | null;
  /** unknown 结束时间。 */
  unknownUntil: string | null;
  /** 隔离释放时间。 */
  quarantineReleasedAt: string | null;
  /** 隔离释放原因。 */
  quarantineReleaseReason: string | null;
  /** 重新观测时间。 */
  reobservedAt: string | null;
  /** 解决结果。 */
  resolution: Resolution | null;
}

/** 解析 OperationView。
 * @param value 未信任的 JSON。
 * @returns 类型安全的 OperationView。
 * @throws ApiError 响应不符合契约。
 */
export function parseOperation(value: unknown): OperationView {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.status !== 'string'
  )
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid operation.');
  const resolutionValue =
    value.resolution === null
      ? null
      : expectRecord(value.resolution, 'resolution');
  const resolution =
    resolutionValue === null
      ? null
      : {
          kind: expectEnum(
            resolutionValue.kind,
            ['observed', 'superseded', 'abandoned'] as const,
            'resolution.kind',
          ),
          note: nullableString(resolutionValue.note, 'resolution.note'),
          resolvedAt: expectString(
            resolutionValue.resolvedAt,
            'resolution.resolvedAt',
          ),
          runId: nullableString(resolutionValue.runId, 'resolution.runId'),
        };
  const taskValue =
    value.task === null ? null : expectRecord(value.task, 'task');
  const task =
    taskValue === null
      ? null
      : {
          id: expectString(taskValue.id, 'task.id'),
          state: nullableNumber(taskValue.state, 'task.state'),
        };
  const upload =
    value.multipart === null
      ? null
      : expectRecord(value.multipart, 'multipart');
  const multipart =
    upload === null
      ? null
      : {
          uploadId: expectString(upload.uploadId, 'multipart.uploadId'),
          chunkSize: expectNumber(upload.chunkSize, 'multipart.chunkSize'),
          state: nullableString(upload.state, 'multipart.state'),
          attempt: nullableNumber(upload.attempt, 'multipart.attempt'),
          sourceStreamCompletedAt: nullableString(
            upload.sourceStreamCompletedAt,
            'multipart.sourceStreamCompletedAt',
          ),
        };
  return {
    id: value.id,
    runId: expectString(value.runId, 'runId'),
    runTargetId: expectString(value.runTargetId, 'runTargetId'),
    seq: expectNumber(value.seq, 'seq'),
    action: expectEnum(value.action, ['mkdir', 'create', 'delete'], 'action'),
    method: expectEnum(
      value.method,
      ['mkdir', 'relay', 'server_copy', 'remove'],
      'method',
    ),
    reason: expectEnum(
      value.reason,
      ['prepare', 'new', 'replace', 'extra', 'retry_cleanup'],
      'reason',
    ),
    status: expectEnum(value.status, OPERATION_STATUSES, 'status'),
    sourceInstanceId: nullableString(
      value.sourceInstanceId,
      'sourceInstanceId',
    ),
    sourceInstanceName: nullableString(
      value.sourceInstanceName,
      'sourceInstanceName',
    ),
    sourcePath: nullableString(value.sourcePath, 'sourcePath'),
    targetInstanceId: expectString(value.targetInstanceId, 'targetInstanceId'),
    targetInstanceName: expectString(
      value.targetInstanceName,
      'targetInstanceName',
    ),
    targetPath: expectString(value.targetPath, 'targetPath'),
    isDir: expectBoolean(value.isDir, 'isDir'),
    expectedSourceSize: nullableNumber(
      value.expectedSourceSize,
      'expectedSourceSize',
    ),
    expectedTargetSize: nullableNumber(
      value.expectedTargetSize,
      'expectedTargetSize',
    ),
    affectedFileCount: expectNumber(
      value.affectedFileCount,
      'affectedFileCount',
    ),
    affectedBytes: expectNumber(value.affectedBytes, 'affectedBytes'),
    retryOf: nullableString(value.retryOf, 'retryOf'),
    causedByOperationId: nullableString(
      value.causedByOperationId,
      'causedByOperationId',
    ),
    attemptNo: expectNumber(value.attemptNo, 'attemptNo'),
    task,
    multipart,
    resolution,
    bytesDownloaded: expectNumber(value.bytesDownloaded, 'bytesDownloaded'),
    bytesTransferred: expectNumber(value.bytesTransferred, 'bytesTransferred'),
    error: parseDiagnostic(value.error),
    createdAt: expectString(value.createdAt, 'createdAt'),
    updatedAt: expectString(value.updatedAt, 'updatedAt'),
    submittedAt: nullableString(value.submittedAt, 'submittedAt'),
    endedAt: nullableString(value.endedAt, 'endedAt'),
    unknownSince: nullableString(value.unknownSince, 'unknownSince'),
    unknownUntil: nullableString(value.unknownUntil, 'unknownUntil'),
    quarantineReleasedAt: nullableString(
      value.quarantineReleasedAt,
      'quarantineReleasedAt',
    ),
    quarantineReleaseReason: nullableString(
      value.quarantineReleaseReason,
      'quarantineReleaseReason',
    ),
    reobservedAt: nullableString(value.reobservedAt, 'reobservedAt'),
  };
}

/** 解析 Operation 分页。
 * @param value 未信任的 JSON。
 * @returns 类型安全的分页结果。
 * @throws ApiError 响应不符合分页契约。
 */
export function parseOperationPage(value: unknown): Page<OperationView> {
  return parsePage(value, parseOperation, 'operation');
}

/** 判断操作是否仍可能由执行器或维护任务更新。
 * @param operation 当前公开状态和解决结果。
 * @returns 活动操作或未解决 unknown 是否需要轮询。
 * @throws 不适用。
 */
export function operationNeedsPolling(
  operation: Pick<OperationView, 'status' | 'resolution'>,
): boolean {
  return (
    ['pending', 'submitting', 'submitted', 'running'].includes(
      operation.status,
    ) ||
    (operation.status === 'unknown' && operation.resolution === null)
  );
}
