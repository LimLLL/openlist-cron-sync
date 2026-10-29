// 保存已知 copy 任务的远程事实；历史操作结果不因维护观察而改写。
import { Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { operationAttempts } from './operation-schema.js';
import type { ExecutionRecord } from './operation-schema.js';
import { runTargets } from './run-schema.js';
import { instances } from './schema.js';
import { taskTerminal } from '../openlist/task-protocol.js';
import { executionRecord } from './operation-records.js';

const logger = new Logger('RemoteTaskFacts');

/** 读取一次异步任务请求所依据的操作事实。
 * @param db 共享连接或事务。
 * @param id Attempt ID。
 * @returns 指定尝试及其计划；历史已删除时为 undefined。
 * @throws Error 数据库失败。
 */
export function taskFact(
  db: BetterSQLite3Database,
  id: string,
): ExecutionRecord | undefined {
  return executionRecord(db, id);
}
/** 为终态历史取得固定身份与当前凭据。
 * @param db 共享连接。
 * @param op 任务所属操作。
 * @returns 请求实例，不读取旧路径密码。
 * @throws Error 原身份或实例不存在。
 */
export function taskInstance(db: BetterSQLite3Database, op: ExecutionRecord) {
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
/** 条件提交远程状态或结束任务记录删除责任，不新增操作、不改历史结果。
 * @param db 共享连接。
 * @param before 请求前读取的操作事实。
 * @param state 新远程状态；undefined 保持原状态。
 * @param clear 是否结束任务记录删除责任。
 * @returns 事实未变化且已提交时为 true。
 * @throws Error 数据库失败。
 */
export function updateTaskFact(
  db: BetterSQLite3Database,
  before: ExecutionRecord,
  state: number | undefined,
  clear: boolean,
): boolean {
  const changed = db.transaction(
    /** 异步请求返回后复核责任和状态，避免迟到响应覆盖已提交的新事实。
     * @param 不适用。
     * @returns 是否应用响应。
     * @throws Error 数据库失败。
     */
    () => {
      const current = taskFact(db, before.id);
      if (
        !current ||
        !current.remoteCleanupPending ||
        current.remoteState !== before.remoteState
      )
        return false;
      db.update(operationAttempts)
        .set({
          remoteState: state ?? current.remoteState,
          remoteCleanupPending: !clear,
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(operationAttempts.id, before.id),
            eq(operationAttempts.remoteCleanupPending, true),
          ),
        )
        .run();
      return true;
    },
  );
  // 仅记录实际提交的终态逆转；持续运行的常规轮询不重复产生日志。
  if (
    changed &&
    state !== undefined &&
    !taskTerminal(state) &&
    taskTerminal(before.remoteState)
  )
    logger.warn('Remote copy task restarted', {
      attemptId: before.id,
      taskId: before.openlistTaskId,
      previousState: before.remoteState,
      remoteState: state,
    });
  return changed;
}
