// 仅运行已配置真实 OpenList 的集成测试，缺少变量在收集前失败。
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import {
  integrationEnvironment,
  loadLocalIntegrationVariables,
} from './test/integration-environment.js';

// 配置在 worker 启动前加载，补充的变量会被各 worker 继承。
loadLocalIntegrationVariables(new URL('./.env', import.meta.url));
integrationEnvironment();
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.int-spec.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
