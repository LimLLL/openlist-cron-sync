// 创建应用并监听；基础初始化与 e2e 共用同一路径。
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createAppModule } from './app.module.js';
import { applicationOptions, initializeApplication } from './http-setup.js';
import { AppConfig } from './configuration/app-config.js';
import { errorTraits, StartupError } from './common/errors.js';

/** 启动生产进程；失败时输出安全摘要并关闭资源。
 * @param 不适用。
 * @returns 启动完成的 Promise。
 * @throws 不适用；失败转为非零退出码。
 */
async function bootstrap(): Promise<void> {
  // 仅在初始化成功后由此处负责关闭；初始化失败时 initializeApplication 已自行关闭。
  let app: NestExpressApplication | undefined;
  try {
    const created = await NestFactory.create<NestExpressApplication>(
      await createAppModule(),
      applicationOptions(),
    );
    await initializeApplication(created);
    app = created;
    const config = app.get(AppConfig);
    await app.listen(config.port, config.host);
  } catch (error) {
    const logger = new ConsoleLogger({ json: true, colors: false });
    // 只输出异常名和错误码定位根因，不输出可能含路径或 SQL 参数的 message。
    if (error instanceof StartupError)
      logger.error(error.message, {
        errorCode: error.code,
        ...(error.cause === undefined ? {} : errorTraits(error.cause)),
      });
    else
      logger.error('Application startup failed', {
        errorCode: 'INTERNAL_ERROR',
        ...errorTraits(error),
      });
    if (app) {
      try {
        await app.close();
      } catch (cleanup) {
        logger.error('Application cleanup failed', {
          errorCode: 'INTERNAL_ERROR',
          ...errorTraits(cleanup),
        });
      }
    }
    process.exitCode = 1;
  }
}

await bootstrap();
