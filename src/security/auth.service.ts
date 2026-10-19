// 实现管理员初始化、认证、会话撤销和并发安全的改密。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { AppConfig } from '../configuration/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import type { AdminRecord } from '../database/schema.js';
import { ApiError, StartupError } from '../common/errors.js';
import { KeysService } from './keys.service.js';
import { LoginLimiter } from './login-limiter.js';
import {
  hashPassword,
  parsePasswordHash,
  verifyPassword,
} from './passwords.js';
import type { LoginView } from './auth.dto.js';

/** 通过认证的公开身份及撤销版本，不携带密码哈希。 */
export interface Principal {
  /** 固定管理员 ID。 */
  id: 1;
  /** 管理员用户名。 */
  username: string;
  /** 当前 token 版本。 */
  tokenVersion: number;
  /** 是否强制改密。 */
  mustChangePassword: boolean;
}

/** 管理员认证服务。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** 保存认证依赖，构造阶段不进行 I/O。
   * @param config 有效配置。
   * @param database 管理员存储。
   * @param keys 已验证密钥服务。
   * @param jwt JWT 库。
   * @param limiter 登录限流器。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(KeysService) private readonly keys: KeysService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(LoginLimiter) private readonly limiter: LoginLimiter,
  ) {}

  /** 仅在没有管理员时读取 bootstrap 环境并创建管理员。
   * @param 不适用。
   * @returns 初始化完成的 Promise。
   * @throws Error 配置、哈希、存储或控制台输出失败。
   */
  async bootstrap(): Promise<void> {
    const existing = this.database.admin();
    if (existing) {
      parsePasswordHash(existing.passwordHash);
      return;
    }
    const credentials = this.config.bootstrapCredentials();
    const generated = credentials.password === undefined;
    const password =
      credentials.password ?? randomBytes(24).toString('base64url');
    this.database.insertAdmin(
      credentials.username,
      await hashPassword(password),
      generated,
    );
    this.logger.log('Administrator initialized', {
      decision: generated ? 'generated_password' : 'supplied_password',
    });
    if (generated)
      await new Promise<void>(
        /** 输出唯一一次的 bootstrap 秘密，不经过结构化日志器。
         * @param resolve 完成回调。
         * @param reject 失败回调。
         * @returns 不适用。
         * @throws 不适用。
         */
        (resolve, reject) => {
          process.stderr.write(
            `Initial administrator password (change immediately): ${password}\n`,
            /** 确认控制台写入。
             * @param error 输出错误。
             * @returns 不适用。
             * @throws 不适用。
             */
            (error) => {
              if (error)
                reject(
                  new StartupError(
                    'INTERNAL_ERROR',
                    'Cannot display initial administrator password',
                  ),
                );
              else resolve();
            },
          );
        },
      );
  }

  /** 验证凭据并签发固定受众的 JWT。
   * @param username 输入用户名。
   * @param password 输入密码。
   * @param ip 可信代理解析后的 IP。
   * @returns 登录响应。
   * @throws ApiError 认证失败或限流；Error 表示内部错误。
   */
  async login(
    username: string,
    password: string,
    ip: string,
  ): Promise<LoginView> {
    this.limiter.enter(ip, username);
    try {
      const admin = this.requireAdmin();
      const matches = await verifyPassword(password, admin.passwordHash);
      if (!matches || username !== admin.username) {
        this.limiter.failure(ip, username);
        this.logger.warn('Authentication failed', {
          errorCode: 'INVALID_CREDENTIALS',
        });
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
      }
      // scrypt 期间可能发生改密；不能用旧密码签发新版本会话。
      const current = this.requireAdmin();
      if (
        current.tokenVersion !== admin.tokenVersion ||
        current.passwordHash !== admin.passwordHash
      )
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
      const accessToken = await this.jwt.signAsync(
        { sub: '1', ver: admin.tokenVersion },
        {
          secret: this.keys.jwtSecret,
          algorithm: 'HS256',
          issuer: 'openlist-cron-sync',
          audience: 'admin-api',
          expiresIn: this.config.jwtTtlSeconds,
        },
      );
      this.limiter.success(username);
      this.logger.log('Administrator logged in', {
        decision: 'login_succeeded',
      });
      return {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: this.config.jwtTtlSeconds,
        mustChangePassword: admin.mustChangePassword,
      };
    } finally {
      this.limiter.leave();
    }
  }

  /** 校验 JWT 后逐请求读取数据库版本。
   * @param token 管理 JWT。
   * @returns 不含哈希的认证身份。
   * @throws ApiError token 不合法或已撤销；Error 表示数据库故障。
   */
  async authenticate(token: string): Promise<Principal> {
    let claims: Record<string, unknown>;
    try {
      claims = await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        secret: this.keys.jwtSecret,
        algorithms: ['HS256'],
        issuer: 'openlist-cron-sync',
        audience: 'admin-api',
        clockTolerance: 30,
      });
      if (
        !claims ||
        typeof claims !== 'object' ||
        claims.sub !== '1' ||
        claims.iss !== 'openlist-cron-sync' ||
        claims.aud !== 'admin-api' ||
        typeof claims.ver !== 'number' ||
        !Number.isSafeInteger(claims.ver) ||
        claims.ver < 1 ||
        typeof claims.iat !== 'number' ||
        !Number.isSafeInteger(claims.iat) ||
        claims.iat > Math.floor(Date.now() / 1000) + 30 ||
        typeof claims.exp !== 'number' ||
        !Number.isSafeInteger(claims.exp) ||
        claims.exp <= claims.iat
      )
        throw new Error('Invalid claims');
    } catch {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    const admin = this.database.admin();
    if (!admin || admin.tokenVersion !== claims.ver)
      throw new ApiError(401, 'TOKEN_REVOKED', 'Session revoked');
    return {
      id: 1,
      username: admin.username,
      tokenVersion: admin.tokenVersion,
      mustChangePassword: admin.mustChangePassword,
    };
  }

  /** 验证当前密码并通过条件更新防止并发改密覆盖。
   * @param principal JWT 认证身份。
   * @param currentPassword 当前密码。
   * @param newPassword 新密码。
   * @param ip 客户端 IP。
   * @returns 完成 Promise。
   * @throws ApiError 凭据错误、版本过期或限流；Error 表示内部失败。
   */
  async changePassword(
    principal: Principal,
    currentPassword: string,
    newPassword: string,
    ip: string,
  ): Promise<void> {
    this.limiter.enter(ip, principal.username);
    try {
      const admin = this.requireAdmin();
      if (admin.tokenVersion !== principal.tokenVersion)
        throw new ApiError(401, 'TOKEN_REVOKED', 'Session revoked');
      if (!(await verifyPassword(currentPassword, admin.passwordHash))) {
        this.limiter.failure(ip, admin.username);
        this.logger.warn('Password change authentication failed', {
          errorCode: 'INVALID_CREDENTIALS',
        });
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
      }
      const hash = await hashPassword(newPassword);
      if (!this.database.changePassword(admin.tokenVersion, hash))
        throw new ApiError(401, 'TOKEN_REVOKED', 'Session revoked');
      this.logger.log('Administrator password changed', {
        decision: 'sessions_revoked',
      });
    } finally {
      this.limiter.leave();
    }
  }

  /** 获取应当已完成初始化的管理员。
   * @param 不适用。
   * @returns 管理员记录。
   * @throws Error 管理员缺失或数据库读取失败。
   */
  private requireAdmin(): AdminRecord {
    const admin = this.database.admin();
    if (!admin) throw new Error('Administrator is not initialized');
    return admin;
  }
}
