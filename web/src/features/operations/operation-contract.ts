// 定义并校验操作公开响应：列表为逻辑操作摘要，详情另含每次尝试；保持与后端字段边界一致。
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

/** 一个计划动作的摘要；自动重试不会产生新行，失败过的尝试只出现在详情的尝试记录中。 */
export interface OperationView {
  /** 操作 UUID；旧版本的尝试 ID 请求详情时也返回这个 ID。 */
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
  /** 已有的尝试次数，含退避等待中的下一次。 */
  attemptCount: number;
  /** 全部尝试累计下载字节。 */
  bytesDownloaded: number;
  /** 全部尝试累计上传字节。 */
  bytesTransferred: number;
  /** 当前尝试的错误；等待下一次重试时为 null。 */
  error: { code: string; message: string } | null;
  /** 创建时间。 */
  createdAt: string;
  /** 更新时间。 */
  updatedAt: string;
  /** 最早一次提交时间。 */
  submittedAt: string | null;
  /** 结束时间；等待重试时为 null。 */
  endedAt: string | null;
  /** 当前尝试进入 unknown 的时间。 */
  unknownSince: string | null;
}

/** 一次执行尝试的完整事实。 */
export interface AttemptView {
  /** 尝试 UUID；第一次尝试与操作 ID 相同。 */
  id: string;
  /** 第几次尝试，从 1 开始。 */
  attemptNo: number;
  /** 本次尝试的状态。 */
  status: OperationStatus;
  /** 远程复制任务。 */
  task: { id: string; state: number | null } | null;
  /** 远程任务记录是否仍待清理。 */
  remoteCleanupPending: boolean;
  /** 分片上传。 */
  multipart: {
    uploadId: string;
    chunkSize: number;
    state: string | null;
    attempt: number | null;
    sourceStreamCompletedAt: string | null;
  } | null;
  /** 本次下载字节。 */
  bytesDownloaded: number;
  /** 本次上传字节。 */
  bytesTransferred: number;
  /** 本次错误。 */
  error: { code: string; message: string } | null;
  /** 创建时间。 */
  createdAt: string;
  /** 更新时间。 */
  updatedAt: string;
  /** 提交时间。 */
  submittedAt: string | null;
  /** 结束时间。 */
  endedAt: string | null;
  /** 退避结束、计划开始的时间。 */
  nextAttemptAt: string | null;
  /** unknown 开始时间。 */
  unknownSince: string | null;
}

/** 操作详情：摘要加按编号升序的全部尝试。 */
export interface OperationDetail extends OperationView {
  /** 全部尝试，至少一条。 */
  attempts: AttemptView[];
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
  const attemptCount = expectNumber(value.attemptCount, 'attemptCount');
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1)
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid attempt count.');
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
    attemptCount,
    bytesDownloaded: expectNumber(value.bytesDownloaded, 'bytesDownloaded'),
    bytesTransferred: expectNumber(value.bytesTransferred, 'bytesTransferred'),
    error: parseDiagnostic(value.error),
    createdAt: expectString(value.createdAt, 'createdAt'),
    updatedAt: expectString(value.updatedAt, 'updatedAt'),
    submittedAt: nullableString(value.submittedAt, 'submittedAt'),
    endedAt: nullableString(value.endedAt, 'endedAt'),
    unknownSince: nullableString(value.unknownSince, 'unknownSince'),
  };
}

/** 解析一次尝试。
 * @param value 未信任的 JSON。
 * @returns 类型安全的 AttemptView。
 * @throws ApiError 响应不符合契约。
 */
function parseAttempt(value: unknown): AttemptView {
  const attempt = expectRecord(value, 'attempt');
  const taskValue =
    attempt.task === null ? null : expectRecord(attempt.task, 'task');
  const upload =
    attempt.multipart === null
      ? null
      : expectRecord(attempt.multipart, 'multipart');
  return {
    id: expectString(attempt.id, 'attempt.id'),
    attemptNo: expectNumber(attempt.attemptNo, 'attemptNo'),
    status: expectEnum(attempt.status, OPERATION_STATUSES, 'attempt.status'),
    task:
      taskValue === null
        ? null
        : {
            id: expectString(taskValue.id, 'task.id'),
            state: nullableNumber(taskValue.state, 'task.state'),
          },
    remoteCleanupPending: expectBoolean(
      attempt.remoteCleanupPending,
      'remoteCleanupPending',
    ),
    multipart:
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
          },
    bytesDownloaded: expectNumber(attempt.bytesDownloaded, 'bytesDownloaded'),
    bytesTransferred: expectNumber(
      attempt.bytesTransferred,
      'bytesTransferred',
    ),
    error: parseDiagnostic(attempt.error),
    createdAt: expectString(attempt.createdAt, 'createdAt'),
    updatedAt: expectString(attempt.updatedAt, 'updatedAt'),
    submittedAt: nullableString(attempt.submittedAt, 'submittedAt'),
    endedAt: nullableString(attempt.endedAt, 'endedAt'),
    nextAttemptAt: nullableString(attempt.nextAttemptAt, 'nextAttemptAt'),
    unknownSince: nullableString(attempt.unknownSince, 'unknownSince'),
  };
}

/** 解析操作详情；尝试列表必须非空且按编号连续。
 * @param value 未信任的 JSON。
 * @returns 类型安全的 OperationDetail。
 * @throws ApiError 响应不符合契约。
 */
export function parseOperationDetail(value: unknown): OperationDetail {
  const operation = parseOperation(value);
  const raw = expectRecord(value, 'operation').attempts;
  if (!Array.isArray(raw) || raw.length !== operation.attemptCount)
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid operation attempts.');
  const attempts = raw.map(parseAttempt);
  if (
    attempts.some(
      /** 检查尝试编号是否从 1 连续递增。
       * @param attempt 当前尝试。
       * @param index 数组下标。
       * @returns 编号是否不连续。
       * @throws 不适用。
       */
      (attempt, index) => attempt.attemptNo !== index + 1,
    )
  )
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid operation attempts.');
  return { ...operation, attempts };
}

/** 判断操作是否正在退避后等待下一次自动重试。
 * @param operation 操作摘要。
 * @returns 是否等待重试。
 * @throws 不适用。
 */
export function awaitingRetry(
  operation: Pick<OperationView, 'status' | 'attemptCount'>,
): boolean {
  return operation.status === 'pending' && operation.attemptCount > 1;
}

/** 解析 Operation 分页。
 * @param value 未信任的 JSON。
 * @returns 类型安全的分页结果。
 * @throws ApiError 响应不符合分页契约。
 */
export function parseOperationPage(value: unknown): Page<OperationView> {
  return parsePage(value, parseOperation, 'operation');
}

/** 判断操作是否仍处于本地执行阶段；终态 unknown 只作为历史展示。
 * @param operation 当前公开状态。
 * @returns 是否需要轮询执行进度。
 * @throws 不适用。
 */
export function operationNeedsPolling(
  operation: Pick<OperationView, 'status'>,
): boolean {
  return ['pending', 'submitting', 'submitted', 'running'].includes(
    operation.status,
  );
}
