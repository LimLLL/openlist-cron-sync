// 在每次应用创建时解析 M0 配置，管理员凭据延迟到首次初始化。
import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { privateDirectory } from './directories.js';
import {
  absolutePath,
  booleanSetting,
  decodeBase64,
  integerSetting,
  invalidConfig,
  listenHost,
  validPassword,
} from './validation.js';
import type { Environment } from './validation.js';

/** 首次管理员输入；username 为名称，password 未设置时生成随机值。 */
export interface BootstrapCredentials {
  /** 1–64 字符的用户名。 */
  username: string;
  /** 12–128 字符的密码；undefined 表示生成。 */
  password: string | undefined;
}

/** 当前应用的有效配置，不缓存或验证尚未消费的环境变量。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class AppConfig implements OnModuleInit {
  readonly host: string;
  readonly port: number;
  dataDir: string;
  spoolDir: string;
  readonly logLevel: 'error' | 'warn' | 'info' | 'debug';
  readonly trustProxyHops: number;
  readonly apiDocsEnabled: boolean;
  readonly jwtSecret: string | undefined;
  readonly masterKey: string | undefined;
  readonly jwtTtlSeconds: number;
  readonly loginMaxFailures: number;
  readonly loginWindowSeconds: number;
  private readonly environment: Environment;

  /** 解析常规配置，故意不访问 ADMIN_USERNAME/PASSWORD。
   * @param config Nest 为本次应用提供的环境容器。
   * @returns 不适用。
   * @throws StartupError 消费的环境字段非法。
   */
  constructor(@Inject(ConfigService) config: ConfigService) {
    this.environment = config.getOrThrow<Environment>('environment');
    const env = this.environment;
    if (
      !['development', 'test', 'production'].includes(
        env.NODE_ENV ?? 'production',
      )
    )
      invalidConfig('NODE_ENV');
    this.host = listenHost(env.HOST ?? '0.0.0.0');
    this.port = integerSetting(env, 'PORT', 3000, 1, 65535);
    this.dataDir = absolutePath(env.DATA_DIR ?? '/data', 'DATA_DIR');
    this.spoolDir = absolutePath(
      env.SPOOL_DIR ?? join(this.dataDir, 'spool'),
      'SPOOL_DIR',
    );
    const level = env.LOG_LEVEL ?? 'info';
    if (
      level !== 'error' &&
      level !== 'warn' &&
      level !== 'info' &&
      level !== 'debug'
    )
      invalidConfig('LOG_LEVEL');
    this.logLevel = level;
    this.trustProxyHops = integerSetting(env, 'TRUST_PROXY_HOPS', 0, 0, 5);
    this.apiDocsEnabled = booleanSetting(
      env.API_DOCS_ENABLED,
      'API_DOCS_ENABLED',
      true,
    );
    this.jwtSecret = this.optionalKey('JWT_SECRET');
    this.masterKey = this.optionalKey('ENCRYPTION_MASTER_KEY');
    this.jwtTtlSeconds = integerSetting(
      env,
      'ADMIN_JWT_TTL_SECONDS',
      28800,
      300,
      86400,
    );
    this.loginMaxFailures = integerSetting(env, 'LOGIN_MAX_FAILURES', 5, 1, 20);
    this.loginWindowSeconds = integerSetting(
      env,
      'LOGIN_WINDOW_SECONDS',
      900,
      60,
      86400,
    );
  }

  /** 在数据库初始化前准备数据和 spool 目录。
   * @param 不适用。
   * @returns 目录准备完成的 Promise。
   * @throws StartupError 目录权限无法建立。
   */
  async onModuleInit(): Promise<void> {
    this.dataDir = await privateDirectory(this.dataDir, 'DATA_DIR');
    this.spoolDir = await privateDirectory(this.spoolDir, 'SPOOL_DIR');
  }

  /** 仅在数据库中没有管理员时调用。
   * @param 不适用。
   * @returns 首次初始化凭据。
   * @throws StartupError 首次用户名或密码非法。
   */
  bootstrapCredentials(): BootstrapCredentials {
    const username = this.environment.ADMIN_USERNAME ?? 'admin';
    if ([...username].length < 1 || [...username].length > 64)
      invalidConfig('ADMIN_USERNAME');
    const password = this.environment.ADMIN_PASSWORD;
    if (password !== undefined && !validPassword(password))
      invalidConfig('ADMIN_PASSWORD');
    return { username, password };
  }

  /** 读取一个可选的 32 字节密钥。
   * @param field 环境字段名。
   * @returns 标准 base64 或 undefined。
   * @throws StartupError 密钥编码非法。
   */
  private optionalKey(field: string): string | undefined {
    const value = this.environment[field];
    if (value !== undefined) {
      try {
        decodeBase64(value, 32);
      } catch {
        invalidConfig(field);
      }
    }
    return value;
  }
}
