// 定义 M0 唯一业务表，迁移由 drizzle-kit 生成。
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const admins = sqliteTable(
  'admins',
  {
    id: integer('id').primaryKey(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    tokenVersion: integer('token_version').notNull().default(1),
    mustChangePassword: integer('must_change_password', {
      mode: 'boolean',
    }).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  /** 生成单管理员及基本数据约束。
   * @param table 管理员表字段。
   * @returns SQL CHECK 列表。
   * @throws 不适用。
   */
  (table) => [
    check('admins_singleton', sql`${table.id} = 1`),
    check(
      'admins_username_length',
      sql`length(${table.username}) BETWEEN 1 AND 64`,
    ),
    check(
      'admins_token_version',
      sql`${table.tokenVersion} BETWEEN 1 AND 9007199254740991`,
    ),
    check('admins_must_change', sql`${table.mustChangePassword} IN (0, 1)`),
    check(
      'admins_timestamps',
      sql`${table.createdAt} >= 0 AND ${table.updatedAt} >= 0`,
    ),
  ],
);

/** 管理员存储记录；字段对应表中的身份、哈希、撤销版本、改密标志和 UTC 毫秒时间。 */
export type AdminRecord = typeof admins.$inferSelect;
