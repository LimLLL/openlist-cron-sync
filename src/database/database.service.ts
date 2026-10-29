// 管理 SQLite 生命周期、迁移和管理员的参数化数据访问。
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, eq, sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AppConfig } from '../configuration/app-config.js';
import { StartupError } from '../common/errors.js';
import { admins } from './schema.js';
import type { AdminRecord } from './schema.js';
import { compactDatabase, reclaimHistory } from './sqlite-storage.js';

/** SQLite 连接和管理员数据访问服务。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private connection: Database.Database | undefined;
  private database: BetterSQLite3Database | undefined;
  private readonly logger = new Logger(DatabaseService.name);

  /** 保存配置，构造阶段不打开数据库。
   * @param config 有效配置。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(@Inject(AppConfig) private readonly config: AppConfig) {}

  /** 打开数据库、验证 PRAGMA 并应用发行版迁移。
   * @param 不适用。
   * @returns 不适用。
   * @throws StartupError 数据库、PRAGMA 或迁移失败。
   */
  onModuleInit(): void {
    try {
      this.connection = new Database(join(this.config.dataDir, 'app.sqlite'));
      if (
        !this.connection
          .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' LIMIT 1")
          .get()
      )
        this.connection.pragma('auto_vacuum=INCREMENTAL');
      this.connection.pragma('foreign_keys = ON');
      this.connection.pragma('journal_mode = WAL');
      this.connection.pragma('synchronous = FULL');
      this.connection.pragma('busy_timeout = 5000');
      for (const [name, expected] of [
        ['foreign_keys', 1],
        ['journal_mode', 'wal'],
        ['synchronous', 2],
        ['busy_timeout', 5000],
      ] as const) {
        if (this.connection.pragma(name, { simple: true }) !== expected)
          throw new Error('PRAGMA mismatch');
      }
      this.database = drizzle(this.connection);
      // SQLite 不允许在事务内切换 foreign_keys；Drizzle 负责整个迁移事务。
      // 重建父表的迁移在提交前自行断言外键完整性，普通启动也检查现存数据。
      this.connection.pragma('foreign_keys = OFF');
      if (this.connection.pragma('foreign_keys', { simple: true }) !== 0)
        throw new Error('Cannot disable foreign keys for migration');
      const migrationStarted = Date.now();
      migrate(this.database, {
        migrationsFolder: fileURLToPath(
          new URL('../../drizzle/', import.meta.url),
        ),
      });
      this.connection.pragma('foreign_keys = ON');
      if (this.connection.pragma('foreign_keys', { simple: true }) !== 1)
        throw new Error('Cannot restore foreign key enforcement');
      if (
        this.connection
          .prepare('SELECT 1 FROM pragma_foreign_key_check LIMIT 1')
          .get()
      )
        throw new Error('Foreign key integrity check failed');
      this.logger.log('Database migrations completed', {
        phase: 'migration',
        elapsedMs: Date.now() - migrationStarted,
      });
      // DROP TEMP表只释放页，SQLite仍可能持有整个迁移临时文件。
      // 此时迁移已提交且没有应用TEMP对象；清空临时库并恢复原设置后再压缩主库。
      const tempStore = Number(
        this.connection.pragma('temp_store', { simple: true }),
      );
      this.connection.pragma(`temp_store=${tempStore === 2 ? 0 : 2}`);
      this.connection.pragma(`temp_store=${tempStore}`);
      compactDatabase(this.connection);
      this.logger.log('Database initialized', {
        decision: 'migrations_applied',
      });
    } catch (error) {
      this.close();
      let cause = error;
      while (cause instanceof Error) {
        const diagnostic =
          /^OPERATION_MIGRATION ([A-Z_]+) ([0-9a-f-]{36})$/.exec(cause.message);
        if (diagnostic)
          throw new StartupError(
            'INTERNAL_ERROR',
            `Operation migration rejected: ${diagnostic[1]}; row=${diagnostic[2]}`,
            error,
          );
        cause = cause.cause;
      }
      throw new StartupError(
        'INTERNAL_ERROR',
        'Database initialization or migration failed',
        error,
      );
    }
  }

  /** 复用当前连接回收历史空闲页，不暴露连接给执行器。
   * @param signal 维护关闭信号。
   * @returns 回收结束。
   * @throws Error 数据库未初始化、SQL失败或关闭。
   */
  reclaimHistory(signal: AbortSignal): Promise<void> {
    if (!this.connection) throw new Error('Database is not initialized');
    return reclaimHistory(this.connection, signal);
  }
  /** 获取初始化后的数据库。
   * @param 不适用。
   * @returns Drizzle 数据库。
   * @throws Error 初始化未完成。
   */
  get db(): BetterSQLite3Database {
    if (!this.database) throw new Error('Database is not initialized');
    return this.database;
  }

  /** 查询唯一管理员。
   * @param 不适用。
   * @returns 管理员，或尚未初始化时的 undefined。
   * @throws Error 数据库读取失败。
   */
  admin(): AdminRecord | undefined {
    return this.db.select().from(admins).where(eq(admins.id, 1)).get();
  }

  /** 插入唯一管理员，禁止覆盖已有记录。
   * @param username 用户名。
   * @param passwordHash 已完成的 scrypt 哈希。
   * @param mustChangePassword 是否强制改密。
   * @returns 不适用。
   * @throws Error 数据库写入或约束失败。
   */
  insertAdmin(
    username: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): void {
    const now = Date.now();
    this.db
      .insert(admins)
      .values({
        id: 1,
        username,
        passwordHash,
        tokenVersion: 1,
        mustChangePassword,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  /** 用单条条件更新原子替换密码并撤销旧会话。
   * @param expectedVersion 校验密码时看到的版本。
   * @param passwordHash 新密码哈希。
   * @returns 是否成功更新；false 表示并发改密已使请求过期。
   * @throws Error 数据库写入失败。
   */
  changePassword(expectedVersion: number, passwordHash: string): boolean {
    return (
      this.db
        .update(admins)
        .set({
          passwordHash,
          tokenVersion: sql`${admins.tokenVersion} + 1`,
          mustChangePassword: false,
          updatedAt: Date.now(),
        })
        .where(and(eq(admins.id, 1), eq(admins.tokenVersion, expectedVersion)))
        .run().changes === 1
    );
  }

  /** 执行只读健康检查。
   * @param 不适用。
   * @returns 数据库是否可读。
   * @throws 不适用；故障记录安全摘要并转换为 health 状态。
   */
  healthy(): boolean {
    try {
      this.db.get(sql`SELECT 1`);
      return true;
    } catch {
      this.logger.error('Database health check failed', {
        errorCode: 'INTERNAL_ERROR',
      });
      return false;
    }
  }

  /** HTTP 关闭后释放数据库。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error SQLite 关闭失败。
   */
  onApplicationShutdown(): void {
    this.close();
  }

  /** 释放完整或部分初始化的连接。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error SQLite 关闭失败。
   */
  private close(): void {
    if (this.connection?.open) this.connection.close();
    this.database = undefined;
    this.connection = undefined;
  }
}
