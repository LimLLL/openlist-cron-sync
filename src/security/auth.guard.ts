// 默认保护管理路由，仅通过显式元数据开放公共端点。
import { Inject, Injectable, SetMetadata } from '@nestjs/common';
import type {
  CanActivate,
  ExecutionContext,
  CustomDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import type { Principal } from './auth.service.js';
import { ApiError } from '../common/errors.js';

const PUBLIC_ROUTE = Symbol('PUBLIC_ROUTE');
const ALLOW_PASSWORD_CHANGE = Symbol('ALLOW_PASSWORD_CHANGE');

/** 请求的附加认证身份；principal 仅由 guard 写入。 */
export interface AuthenticatedRequest extends Request {
  /** 已认证身份，公共路由不提供。 */
  principal?: Principal;
}

/** 标记明确公开的路由。
 * @param 不适用。
 * @returns Nest 元数据装饰器。
 * @throws 不适用。
 */
export function Public(): CustomDecorator<typeof PUBLIC_ROUTE> {
  return SetMetadata(PUBLIC_ROUTE, true);
}

/** 允许强制改密状态使用此端点。
 * @param 不适用。
 * @returns Nest 元数据装饰器。
 * @throws 不适用。
 */
export function AllowPasswordChange(): CustomDecorator<
  typeof ALLOW_PASSWORD_CHANGE
> {
  return SetMetadata(ALLOW_PASSWORD_CHANGE, true);
}

/** 默认认证及强制改密 guard。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  /** 保存认证和元数据依赖。
   * @param auth 认证服务。
   * @param reflector 路由元数据读取器。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  /** 校验 Bearer token 并限制首次随机密码会话。
   * @param context Nest 请求上下文。
   * @returns 是否允许进入路由。
   * @throws ApiError 缺失、无效、撤销 token 或必须改密。
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets))
      return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token =
      typeof header === 'string'
        ? /^Bearer ([^\s]+)$/i.exec(header)?.[1]
        : undefined;
    if (!token)
      throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    request.principal = await this.auth.authenticate(token);
    if (
      request.principal.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE, targets)
    ) {
      throw new ApiError(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Password change required',
      );
    }
    return true;
  }
}

/** 从已保护请求中取得身份。
 * @param request 当前请求。
 * @returns 认证身份。
 * @throws ApiError 未经过认证。
 */
export function principalOf(request: AuthenticatedRequest): Principal {
  if (!request.principal)
    throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  return request.principal;
}

/** 读取 Express 按 trust proxy 规则解析的 IP。
 * @param request 当前请求。
 * @returns IP；缺失时所有此类请求共享同一个受限键。
 * @throws 不适用。
 */
export function clientIp(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}
