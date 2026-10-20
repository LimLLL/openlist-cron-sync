// 定义 SQLite 迁移生成位置，不连接运行中的数据库。
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  // drizzle-kit 0.31 读取 TS 源码时无法解析 NodeNext 要求的 .js 相对引用（上游 issue #2705），
  // 因此读取编译产物；pnpm run db:generate 会先执行 nest build，保证产物最新。
  schema: './dist/database/schema.js',
  out: './drizzle',
});
