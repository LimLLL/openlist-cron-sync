// 仅测试使用的 ENC 表，不进入生产 schema 或迁移。
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const fixtureSecrets = sqliteTable('fixture_secrets', {
  id: integer('id').primaryKey(),
  secret: text('secret_enc'),
});
export const fixtureColumns = [
  {
    table: fixtureSecrets,
    id: fixtureSecrets.id,
    value: fixtureSecrets.secret,
  },
];
