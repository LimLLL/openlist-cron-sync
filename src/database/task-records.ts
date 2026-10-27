// 保存copy任务事实及维护边沿；异步响应提交时复查责任，历史结果不重写。
import { randomUUID } from 'node:crypto';
import { and, desc, eq, max } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { operations } from './operation-schema.js';
import type { OperationRecord } from './operation-schema.js';
import { runTargets } from './run-schema.js';
import { instances } from './schema.js';
import { taskTerminal } from '../openlist/task-protocol.js';

/** 一次维护异步调用前读取的责任事实。 */
export interface TaskFact {
  /** tid所属原始记录。 */ operation: OperationRecord;
  /** 最新远程状态变化事件。 */ child: OperationRecord | undefined;
}
/** 读取当前原行及最新维护子记录。
 * @param db 共享连接或事务。
 * @param id 原Operation ID。
 * @returns 当前事实；被历史清理时undefined。
 * @throws Error 数据库失败。
 */
export function taskFact(
  db: BetterSQLite3Database,
  id: string,
): TaskFact | undefined {
  const operation = db
    .select()
    .from(operations)
    .where(eq(operations.id, id))
    .get();
  if (!operation) return undefined;
  const child = db
    .select()
    .from(operations)
    .where(eq(operations.causedByOperationId, id))
    .orderBy(desc(operations.seq))
    .limit(1)
    .get();
  return { operation, child };
}
/** 判断当前任务是否仍为未知副作用提供跟踪。
 * @param fact 当前数据库事实。
 * @returns 是否safety跟踪。
 * @throws 不适用。
 */
export function safetyTracked(fact: TaskFact): boolean {
  return (
    (fact.operation.status === 'unknown' &&
      fact.operation.resolutionKind === null) ||
    (fact.child?.status === 'unknown' && fact.child.resolutionKind === null)
  );
}
/** 为终态历史取得固定身份与当前凭据。
 * @param db 共享连接。
 * @param op 任务所属操作。
 * @returns 请求实例，不读取旧路径密码。
 * @throws Error 原身份或实例不存在。
 */
export function taskInstance(db: BetterSQLite3Database, op: OperationRecord) {
  const target = db
    .select()
    .from(runTargets)
    .where(eq(runTargets.id, op.runTargetId))
    .get();
  const current = db
    .select()
    .from(instances)
    .where(eq(instances.id, op.targetInstanceId))
    .get();
  if (!target || !current) throw new Error('Task identity missing');
  const fixed = target.config.instance;
  return {
    ...current,
    baseUrl: fixed.baseUrl,
    authMode: fixed.authMode,
    username: fixed.username,
    accountUsername: fixed.accountUsername,
    accountBasePath: fixed.accountBasePath,
    accountRole: fixed.accountRole,
    accountPermissions: fixed.accountPermissions,
  };
}
/** 对异步结果做条件提交，维护只修改remote事实或新增unknown。
 * @param db 共享连接。
 * @param before 请求前事实。
 * @param state 新remote状态，undefined保持。
 * @param clear 是否终止记录清理责任。
 * @param quarantineSeconds 当前进程隔离秒数。
 * @returns 是否事实未变化且已提交。
 * @throws Error 数据库失败。
 */
export function updateTaskFact(
  db: BetterSQLite3Database,
  before: TaskFact,
  state: number | undefined,
  clear: boolean,
  quarantineSeconds: number,
): boolean {
  return db.transaction(
    /** 复核flag及两类resolution，避免响应覆盖新的管理决定。
     * @param 不适用。
     * @returns 是否应用结果。
     * @throws Error 数据库失败。
     */
    () => {
      const current = taskFact(db, before.operation.id);
      if (
        !current ||
        !current.operation.remoteCleanupPending ||
        current.operation.remoteState !== before.operation.remoteState ||
        current.operation.resolutionKind !== before.operation.resolutionKind ||
        current.child?.id !== before.child?.id ||
        current.child?.resolutionKind !== before.child?.resolutionKind
      )
        return false;
      const now = Date.now();
      if (
        state !== undefined &&
        !taskTerminal(state) &&
        taskTerminal(current.operation.remoteState)
      ) {
        const original = current.operation;
        const seq =
          (db
            .select({ n: max(operations.seq) })
            .from(operations)
            .where(eq(operations.runId, original.runId))
            .get()?.n ?? 0) + 1;
        db.insert(operations)
          .values({
            ...original,
            id: randomUUID(),
            seq,
            status: 'unknown',
            retryOf: null,
            attemptNo: 1,
            causedByOperationId: original.id,
            openlistTaskId: null,
            remoteState: null,
            remoteCleanupPending: false,
            bytesDownloaded: 0,
            bytesTransferred: 0,
            errorCode: 'REMOTE_TASK_CHANGED',
            errorMessage: 'Remote copy task restarted',
            createdAt: now,
            updatedAt: now,
            submittedAt: null,
            endedAt: now,
            nextAttemptAt: null,
            unknownSince: now,
            unknownUntil: now + quarantineSeconds * 1000,
            quarantineReleasedAt: null,
            quarantineReleaseReason: null,
            reobservedAt: null,
            reobservedByRunId: null,
            resolutionKind: null,
            resolutionNote: null,
            resolvedAt: null,
            resolvedByRunId: null,
          })
          .run();
      }
      db.update(operations)
        .set({
          remoteState: state ?? current.operation.remoteState,
          remoteCleanupPending: !clear,
          updatedAt: now,
        })
        .where(
          and(
            eq(operations.id, before.operation.id),
            eq(operations.remoteCleanupPending, true),
          ),
        )
        .run();
      return true;
    },
  );
}
