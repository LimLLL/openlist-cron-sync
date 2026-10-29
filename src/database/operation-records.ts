// 共用逻辑操作与尝试的关联、规划写入及批量终态事务。
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { operations, operationAttempts } from './operation-schema.js';
import type { ExecutionRecord } from './operation-schema.js';

/** 执行输入的显式列：尝试字段覆盖同名状态和时间，operationId保留逻辑身份。 */
export const executionColumns = {
  ...getTableColumns(operations),
  ...getTableColumns(operationAttempts),
};
/** 当前尝试通过连续编号关联，不遍历历史链。 */
export const currentAttempt = and(
  eq(operationAttempts.operationId, operations.id),
  eq(operationAttempts.attemptNo, operations.attemptCount),
);

/** 读取指定尝试和其不可变计划。
 * @param db 数据库。
 * @param id Attempt ID。
 * @returns 完整执行上下文，不存在时undefined。
 * @throws Error 数据库失败。
 */
export function executionRecord(
  db: BetterSQLite3Database,
  id: string,
): ExecutionRecord | undefined {
  return db
    .select(executionColumns)
    .from(operationAttempts)
    .innerJoin(operations, eq(operations.id, operationAttempts.operationId))
    .where(eq(operationAttempts.id, id))
    .get();
}

/** 在调用方规划事务内同时建立操作和首次尝试。
 * @param db 数据库或现有事务。
 * @param row 新逻辑操作，尚无执行事实。
 * @returns 不适用。
 * @throws Error 数据库或约束失败。
 */
export function insertOperation(
  db: BetterSQLite3Database,
  row: typeof operations.$inferInsert,
): void {
  db.insert(operations).values(row).run();
  db.insert(operationAttempts)
    .values({
      id: row.id,
      operationId: row.id,
      targetInstanceId: row.targetInstanceId,
      method: row.method,
      status: row.status ?? 'pending',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      endedAt: row.endedAt ?? null,
    })
    .run();
}

/** 将满足条件的当前尝试与逻辑操作原子收尾；仅用于不安排重试的批量路径。
 * @param db 单写连接或外层事务。
 * @param condition 调用方限定Run、状态及ID的条件。
 * @param outcome 批量终态和受控原因。
 * @returns 不适用。
 * @throws Error 缺少条件或数据库失败，整批回滚。
 */
export function endOperations(
  db: BetterSQLite3Database,
  condition: SQL | undefined,
  outcome: {
    status: 'skipped' | 'cancelled' | 'unknown';
    code?: string;
    message?: string;
  },
): void {
  // and()的类型允许undefined；无条件会把全部历史操作改为终态，必须拒绝。
  if (!condition) throw new Error('Operation end condition missing');
  db.transaction(
    /** 先按收尾前的父状态选中当前尝试，再更新父状态，二者同批提交。
     * @param 不适用。
     * @returns 不适用。
     * @throws Error 数据库失败。
     */
    () => {
      const now = Date.now();
      db.update(operationAttempts)
        .set({
          status: outcome.status,
          errorCode: outcome.code ?? null,
          errorMessage: outcome.message ?? outcome.code ?? null,
          endedAt: now,
          updatedAt: now,
          unknownSince: outcome.status === 'unknown' ? now : null,
          remoteCleanupPending: sql`CASE WHEN openlist_task_id IS NOT NULL THEN 1 ELSE 0 END`,
        })
        .where(
          sql`(${operationAttempts.operationId},${operationAttempts.attemptNo}) IN (SELECT ${operations.id},${operations.attemptCount} FROM ${operations} WHERE ${condition})`,
        )
        .run();
      db.update(operations)
        .set({ status: outcome.status, endedAt: now, updatedAt: now })
        .where(condition)
        .run();
    },
  );
}
