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
      migrate(this.database, {
        migrationsFolder: fileURLToPath(
          new URL('../../drizzle/', import.meta.url),
        ),
      });
      this.logger.log('Database initialized', {
        decision: 'migrations_applied',
      });
    } catch (error) {
      this.close();
      throw new StartupError(
        'INTERNAL_ERROR',
        'Database initialization or migration failed',
        error,
      );
    }
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
