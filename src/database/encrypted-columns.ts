// 维护显式 ENC 清单并逐行读取生产密文。
import { instances } from './schema.js';
import { and, asc, gt, isNotNull, getTableName } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';

/** 一个代码定义的加密列，所有 SQL 标识符来自 Drizzle schema。 */
export interface EncryptedColumn {
  /** 所属表。 */
  table: SQLiteTable;
  /** 记录 ID 列。 */
  id: SQLiteColumn;
  /** ENC 列。 */
  value: SQLiteColumn;
}

/** 密文与其 AAD 所需身份。 */
export interface EncryptedValue {
  /** SQL 表名。 */
  table: string;
  /** 字符串化的记录 ID。 */
  recordId: string;
  /** SQL 字段名。 */
  field: string;
  /** 原始 ENC 封装。 */
  value: string;
}

export const ENCRYPTED_COLUMNS = Symbol('ENCRYPTED_COLUMNS');
export const encryptedColumns: readonly EncryptedColumn[] = [
  { table: instances, id: instances.id, value: instances.secretEnc },
];

/** 流式扫描全部非 NULL 密文，不把整库数据载入内存。
 * @param db 已打开的 Drizzle 数据库。
 * @param columns 代码定义的加密列清单。
 * @returns 带 AAD 身份的密文迭代器。
 * @throws Error 数据库访问或记录类型错误。
 */
export function* readEncryptedValues(
  db: BetterSQLite3Database,
  columns: readonly EncryptedColumn[],
): Generator<EncryptedValue> {
  for (const column of columns) {
    let lastId: string | number | undefined;
    while (true) {
      const rows = db
        .select({ id: column.id, value: column.value })
        .from(column.table)
        .where(
          and(
            isNotNull(column.value),
            lastId === undefined ? undefined : gt(column.id, lastId),
          ),
        )
        .orderBy(asc(column.id))
        .limit(100)
        .all();
      if (rows.length === 0) break;
      for (const row of rows) {
        if (
          (typeof row.id !== 'string' && typeof row.id !== 'number') ||
          typeof row.value !== 'string'
        ) {
          throw new Error('Invalid encrypted record');
        }
        lastId = row.id;
        yield {
          table: getTableName(column.table),
          recordId: String(row.id),
          field: column.value.name,
          value: row.value,
        };
      }
    }
  }
}
