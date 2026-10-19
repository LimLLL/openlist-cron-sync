// 将验证、框架和解析异常统一转换为不含秘密的公共错误。
import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { ValidationError } from 'class-validator';
import { ApiError, errorTraits } from './errors.js';

/** 将校验错误转为安全字段错误，不暴露原对象或输入值。
 * @param errors class-validator 错误列表。
 * @returns 公共验证错误。
 * @throws 不适用。
 */
export function validationException(errors: ValidationError[]): ApiError {
  return new ApiError(
    400,
    'VALIDATION_ERROR',
    'Invalid request',
    errors.map(
      /** 仅保留字段名和固定原因，不回显字段值。
       * @param error 字段错误。
       * @returns 公开字段错误。
       * @throws 不适用。
       */
      (error) => ({
        field: error.property,
        reason: error.constraints?.whitelistValidation
          ? 'Unknown field'
          : 'Invalid value',
      }),
    ),
  );
}

/** 将框架错误归一化，不转发异常中的 message/response/body。
 * @param error 捕获的未知异常。
 * @returns 安全的 HTTP 错误。
 * @throws 不适用。
 */
function publicError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error && 'type' in error) {
    if (error.type === 'entity.too.large')
      return new ApiError(
        413,
        'PAYLOAD_TOO_LARGE',
        'Request body exceeds limit',
      );
    if (error.type === 'entity.parse.failed')
      return new ApiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
    // body-parser 的其余客户端错误（不支持的字符集或压缩编码、请求中止等）不是服务端故障。
    if (
      'status' in error &&
      typeof error.status === 'number' &&
      error.status >= 400 &&
      error.status < 500
    )
      return new ApiError(400, 'VALIDATION_ERROR', 'Invalid request body');
  }
  const status = error instanceof HttpException ? error.getStatus() : 500;
  switch (status) {
    case 400:
      return new ApiError(400, 'VALIDATION_ERROR', 'Invalid request');
    case 401:
      return new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    case 404:
      return new ApiError(404, 'NOT_FOUND', 'Resource not found');
    case 413:
      return new ApiError(
        413,
        'PAYLOAD_TOO_LARGE',
        'Request body exceeds limit',
      );
    default:
      return new ApiError(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

/** 所有 HTTP 异常共用的输出过滤器。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  /** 写入公共错误体和可选 Retry-After。
   * @param exception 未知异常。
   * @param host HTTP 上下文。
   * @returns 不适用。
   * @throws 不适用。
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const error = publicError(exception);
    const requestId = String(response.getHeader('X-Request-Id'));
    if (error.retryAfter !== undefined)
      response.setHeader('Retry-After', error.retryAfter);
    if (error.getStatus() >= 500)
      this.logger.error('Request failed', {
        requestId,
        errorCode: error.code,
        ...errorTraits(exception),
      });
    response.status(error.getStatus()).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
      requestId,
    });
  }
}
