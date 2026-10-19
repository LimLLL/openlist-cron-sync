// 定义 SQLite 迁移生成位置，不连接运行中的数据库。
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/database/schema.ts',
  out: './drizzle',
});
