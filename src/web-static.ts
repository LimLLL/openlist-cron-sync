// 定义 SPA 静态托管边界；API、文档和缺失资源继续走原有 HTTP 错误处理。
import { fileURLToPath } from 'node:url';
import type { ServeStaticModuleOptions } from '@nestjs/serve-static';

/** 源码与编译产物均位于项目根下一层，静态目录不依赖启动工作目录。 */
export const webStaticOptions: ServeStaticModuleOptions = {
  rootPath: fileURLToPath(new URL('../web/dist/', import.meta.url)),
  useGlobalPrefix: false,
  exclude: /^\/api(?:\/|$)/i,
  // 仅浏览器页面使用 HTML 回退，资源缺失不能伪装成成功的 JavaScript 响应。
  renderPath: /^(?!\/(?:api|assets)(?:\/|$))(?!.*\.).*$/i,
  serveStaticOptions: { index: false, redirect: false, maxAge: 0 },
};
