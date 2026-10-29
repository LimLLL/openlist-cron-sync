// 测试用真实父子记录写入；用显式operationId建立历史尝试，不模拟生产Store。
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  operations,
  operationAttempts,
} from '../src/database/operation-schema.js';
import type {
  ExecutionRecord,
  AttemptRecord,
} from '../src/database/operation-schema.js';

/** 规划字段和可选执行事实；operationId非空表示给已有操作增加尝试。 */
type Seed = typeof operations.$inferInsert & Partial<AttemptRecord>;
/** 按实际表字段投影测试数据，防止计划字段落进尝试表。
 * @param row 测试对象。
 * @param columns 目标表列。
 * @returns 目标表允许的键值。
 * @throws 不适用。
 */
function fields(row: object, columns: object) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => key in columns),
  );
}
/** 创建真实操作和尝试，或追加指定操作的下一次历史尝试。
 * @param db 测试数据库。
 * @param input 一个或多个完整种子。
 * @returns 不适用。
 * @throws Error 数据库约束失败。
 */
export function seedOperations(
  db: BetterSQLite3Database,
  input: Seed | Seed[],
): void {
  db.transaction(() => {
    for (const row of Array.isArray(input) ? input : [input]) {
      const operationId = row.operationId ?? row.id;
      const attemptNo = row.attemptNo ?? 1;
      if (!row.operationId)
        db.insert(operations)
          .values({
            ...fields(row, getTableColumns(operations)),
            attemptCount: attemptNo,
          } as typeof operations.$inferInsert)
          .run();
      else
        db.update(operations)
          .set({
            attemptCount: attemptNo,
            status: row.status ?? 'pending',
            endedAt: row.endedAt ?? null,
            updatedAt: row.updatedAt,
          })
          .where(eq(operations.id, operationId))
          .run();
      db.insert(operationAttempts)
        .values({
          ...fields(row, getTableColumns(operationAttempts)),
          operationId,
          attemptNo,
        } as typeof operationAttempts.$inferInsert)
        .run();
    }
  });
}
/** 在真实数据库中构造一个当前尝试的崩溃窗口，父子状态同事务保存。
 * @param db 测试数据库。
 * @param condition 使用operations列的选择条件。
 * @param changes 当前尝试和计划需要改写的字段。
 * @returns 不适用。
 * @throws Error 数据库约束失败。
 */
export function setOperation(
  db: BetterSQLite3Database,
  condition: SQL | undefined,
  changes: Partial<ExecutionRecord>,
): void {
  db.transaction(() => {
    db.run(sql`PRAGMA defer_foreign_keys=ON`);
    const rows = db.select().from(operations).where(condition).all();
    const parent = fields(changes, getTableColumns(operations));
    const child = fields(changes, getTableColumns(operationAttempts));
    for (const row of rows) {
      if (Object.keys(parent).length)
        db.update(operations)
          .set(parent)
          .where(eq(operations.id, row.id))
          .run();
      if (Object.keys(child).length)
        db.update(operationAttempts)
          .set(child)
          .where(
            and(
              eq(operationAttempts.operationId, row.id),
              eq(operationAttempts.attemptNo, row.attemptCount),
            ),
          )
          .run();
    }
  });
}
