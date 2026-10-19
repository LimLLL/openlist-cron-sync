// 提供登录、当前管理员和改密端点。
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import {
  AdminView,
  ChangePasswordDto,
  LoginDto,
  LoginView,
} from './auth.dto.js';
import {
  AllowPasswordChange,
  clientIp,
  principalOf,
  Public,
} from './auth.guard.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import { EmptyQueryDto } from '../common/http.dto.js';

/** 单管理员认证控制器。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  /** 保存认证服务。
   * @param auth 认证服务。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** 公开登录。
   * @param input 登录 DTO。
   * @param request 当前请求。
   * @param _query 必须为空的查询。
   * @returns 管理会话。
   * @throws ApiError 校验、认证或限流失败。
   */
  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: LoginView })
  login(
    @Body() input: LoginDto,
    @Req() request: AuthenticatedRequest,
    @Query() _query: EmptyQueryDto,
  ): Promise<LoginView> {
    return this.auth.login(input.username, input.password, clientIp(request));
  }

  /** 返回管理员公开字段。
   * @param request 已认证请求。
   * @param _query 必须为空的查询。
   * @returns 管理员视图。
   * @throws ApiError 未认证。
   */
  @AllowPasswordChange()
  @ApiBearerAuth()
  @Get('me')
  @ApiOkResponse({ type: AdminView })
  me(
    @Req() request: AuthenticatedRequest,
    @Query() _query: EmptyQueryDto,
  ): AdminView {
    const principal = principalOf(request);
    return {
      id: principal.id,
      username: principal.username,
      mustChangePassword: principal.mustChangePassword,
    };
  }

  /** 修改密码并撤销所有旧会话。
   * @param input 改密 DTO。
   * @param request 已认证请求。
   * @param _query 必须为空的查询。
   * @returns 完成 Promise，无响应体。
   * @throws ApiError 凭据、撤销版本或限流失败。
   */
  @AllowPasswordChange()
  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(204)
  @ApiNoContentResponse({ description: '所有旧 JWT 失效，须重新登录' })
  changePassword(
    @Body() input: ChangePasswordDto,
    @Req() request: AuthenticatedRequest,
    @Query() _query: EmptyQueryDto,
  ): Promise<void> {
    return this.auth.changePassword(
      principalOf(request),
      input.currentPassword,
      input.newPassword,
      clientIp(request),
    );
  }
}
