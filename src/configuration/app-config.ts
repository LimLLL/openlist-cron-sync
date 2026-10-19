// 在每次应用创建时解析已实现功能的配置，管理员凭据延迟到首次初始化。
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
  /** 上游建连超时，毫秒。 */
  readonly openlistConnectTimeoutMs: number;
  /** 控制 API 请求期限，毫秒。 */
  readonly openlistApiTimeoutMs: number;
  /** 读取总尝试次数，包含首次。 */
  readonly retryMaxAttempts: number;
  /** 指数退避基数，毫秒。 */
  readonly retryBaseMs: number;
  /** 含抖动的退避上限，毫秒。 */
  readonly retryMaxMs: number;
  /** 登录限流后冷却，秒。 */
  readonly openlistAuthCooldownSeconds: number;
  /** 上游 JSON 最大字节数。 */
  readonly openlistMaxJsonBytes: number;
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
    this.openlistConnectTimeoutMs = integerSetting(
      env,
      'OPENLIST_CONNECT_TIMEOUT_MS',
      10000,
      1000,
      120000,
    );
    this.openlistApiTimeoutMs = integerSetting(
      env,
      'OPENLIST_API_TIMEOUT_MS',
      30000,
      1000,
      300000,
    );
    this.retryMaxAttempts = integerSetting(env, 'RETRY_MAX_ATTEMPTS', 3, 1, 10);
    this.retryBaseMs = integerSetting(env, 'RETRY_BASE_MS', 1000, 100, 60000);
    this.retryMaxMs = integerSetting(
      env,
      'RETRY_MAX_MS',
      30000,
      this.retryBaseMs,
      300000,
    );
    if (this.retryMaxMs < this.retryBaseMs) invalidConfig('RETRY_MAX_MS');
    this.openlistAuthCooldownSeconds = integerSetting(
      env,
      'OPENLIST_AUTH_COOLDOWN_SECONDS',
      600,
      600,
      86400,
    );
    this.openlistMaxJsonBytes = integerSetting(
      env,
      'OPENLIST_MAX_JSON_BYTES',
      33554432,
      1024,
      268435456,
    );
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
