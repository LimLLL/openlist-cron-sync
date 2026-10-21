// 配置浏览器构建及开发代理，保留后端 API 的完整路径。
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(
  /** 开发时从仓库根目录读取端口，显式代理端口优先于后端 PORT。
   * @param environment Vite 当前命令与运行模式。
   * @returns 插件与开发代理配置；不改变浏览器环境变量目录。
   * @throws Error 环境文件或插件加载失败。
   */
  ({ command, mode }) => {
    const plugins = [react(), tailwindcss()];
    // loadEnv 也会处理 NODE_ENV；后端开发环境不能影响正式前端构建。
    if (command !== 'serve') return { plugins };
    // 配置求值早于 Vite 自动加载 .env；workspace 的工作目录是 web 而非仓库根。
    const environment = loadEnv(
      mode,
      fileURLToPath(new URL('..', import.meta.url)),
      ['VITE_API_PORT', 'PORT'],
    );
    const port = environment.VITE_API_PORT ?? environment.PORT ?? '3000';
    return {
      plugins,
      server: { proxy: { '/api/v1': `http://localhost:${port}` } },
    };
  },
);
