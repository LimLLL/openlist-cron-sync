// 为生产和 e2e 安装完全相同的 HTTP 配置并执行 Nest 初始化。
import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import type { LogLevel, NestApplicationOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { AppConfig } from './configuration/app-config.js';
import { HttpErrorFilter, validationException } from './common/http-errors.js';
import { ErrorDto } from './common/http.dto.js';
import { ApiError, errorTraits } from './common/errors.js';

/** 创建不缓冲秘密、不自动安装默认 body parser 的应用选项。
 * @param 不适用。
 * @returns 每次新建的 Nest 选项。
 * @throws 不适用。
 */
export function applicationOptions(): NestApplicationOptions {
  return {
    abortOnError: false,
    bodyParser: false,
    // LOG_LEVEL 在配置解析后才生效；此前只输出 warn 及以上，避免低级别配置被启动日志绕过。
    logger: new ConsoleLogger({
      json: true,
      colors: false,
      logLevels: ['error', 'fatal', 'warn'],
    }),
  };
}

/** 生成由本服务控制的请求 ID。
 * @param _request 当前请求，故意忽略外部 ID。
 * @param response HTTP 响应。
 * @param next 后续中间件。
 * @returns 不适用。
 * @throws 不适用。
 */
function requestId(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.setHeader('X-Request-Id', randomUUID());
  next();
}

// JSON.parse 与查询解析会把这些键保留为自有属性，而 DTO 白名单校验不会把它们报告为未知字段。
const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype'];

/** 判断已解析的输入对象是否直接携带保留键。
 * @param input 请求体或查询对象。
 * @returns 是否含保留键。
 * @throws 不适用。
 */
function hasReservedKey(input: object): boolean {
  return RESERVED_KEYS.some(
    /** 检查单个保留键。
     * @param key 保留键名。
     * @returns 是否存在。
     * @throws 不适用。
     */
    (key) => Object.hasOwn(input, key),
  );
}

/** 拒绝管理接口中的非对象 JSON 请求体及携带保留键的输入。
 * @param request 当前请求。
 * @param _response 当前响应。
 * @param next 后续中间件。
 * @returns 不适用。
 * @throws ApiError 非对象请求体、GET 带 body 字段，或请求体/查询含保留键。
 */
function validateInputShape(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  const body: unknown = request.body;
  if (
    body !== undefined &&
    (body === null ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      (request.method === 'GET' && Object.keys(body).length > 0) ||
      hasReservedKey(body))
  ) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request body');
  }
  const query: unknown = request.query;
  if (query !== null && typeof query === 'object' && hasReservedKey(query))
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request');
  next();
}

/** 安装 HTTP 契约并调用唯一的生命周期初始化路径。
 * @param app 生产或 TestingModule 创建的 Express 应用。
 * @returns 初始化完成但尚未监听的 Promise。
 * @throws Error 初始化失败；已创建的资源会被关闭。
 */
export async function initializeApplication(
  app: NestExpressApplication,
): Promise<void> {
  try {
    const config = app.get(AppConfig);
    const levels: Record<AppConfig['logLevel'], LogLevel[]> = {
      error: ['error', 'fatal'],
      warn: ['error', 'fatal', 'warn'],
      info: ['error', 'fatal', 'warn', 'log'],
      debug: ['error', 'fatal', 'warn', 'log', 'debug'],
    };
    app.useLogger(
      new ConsoleLogger({
        json: true,
        colors: false,
        logLevels: levels[config.logLevel],
      }),
    );
    app.setGlobalPrefix('api/v1');
    app.set('trust proxy', config.trustProxyHops);
    app.use(requestId);
    app.useBodyParser('json', { limit: 1024 * 1024 });
    app.use('/api/v1', validateInputShape);
    app.useGlobalFilters(new HttpErrorFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: false,
        transformOptions: { enableImplicitConversion: false },
        validationError: { target: false, value: false },
        exceptionFactory: validationException,
      }),
    );
    if (config.apiDocsEnabled) {
      const builder = new DocumentBuilder()
        .setTitle('openlist-cron-sync')
        .setVersion('0.0.2')
        .addBearerAuth();
      for (const status of [400, 401, 403, 404, 413, 429, 500])
        builder.addGlobalResponse({ status, type: ErrorDto });
      const document = SwaggerModule.createDocument(app, builder.build());
      SwaggerModule.setup('api/v1/docs', app, document, {
        jsonDocumentUrl: 'api/v1/openapi.json',
        raw: ['json'],
      });
    }
    app.enableShutdownHooks();
    await app.init();
  } catch (error) {
    try {
      await app.close();
    } catch (cleanup) {
      new ConsoleLogger({ json: true }).error('Application cleanup failed', {
        errorCode: 'INTERNAL_ERROR',
        ...errorTraits(cleanup),
      });
    }
    throw error;
  }
}
