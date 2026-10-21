// 在 Node 环境中验证前端请求契约及开发代理配置，不启动浏览器。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'vite.config.test.ts'],
    environment: 'node',
  },
});
