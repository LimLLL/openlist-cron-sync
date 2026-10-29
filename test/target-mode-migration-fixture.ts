// 用已发布的原始迁移构造升级前数据库；旧形状只存在于迁移验收夹具。
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { instances } from '../src/database/schema.js';
import { mergeJob } from '../src/jobs/validation.js';
import { instanceSnapshot } from '../src/jobs/endpoint-validation.js';
import { emptyStats } from '../src/sync/stats.js';
import type { AppConfig } from '../src/configuration/app-config.js';
import type { Target } from '../src/jobs/job-types.js';

/** 应用不可改写的前四份迁移，并记录真实 Drizzle 迁移位置。
 * @param directory 测试专用数据目录。
 * @returns 尚未应用本次迁移的连接。
 * @throws Error 迁移文件或 SQLite 初始化失败。
 */
export function legacyDatabase(directory: string): Database.Database {
  const connection = new Database(join(directory, 'app.sqlite'));
  connection.exec(
    'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  connection.transaction(
    /** 按原始顺序建立历史结构，保持升级入口读取的迁移记录一致。
     * @param 不适用。
     * @returns 不适用。
     * @throws Error 历史 SQL 执行失败。
     */
    () => {
      for (const migration of readMigrationFiles({
        migrationsFolder: 'drizzle',
      }).slice(0, 4)) {
        for (const statement of migration.sql) connection.exec(statement);
        connection
          .prepare(
            'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
          )
          .run(migration.hash, migration.folderMillis);
      }
    },
  )();
  connection.pragma('foreign_keys = ON');
  return connection;
}

/** 写入当前配置与历史快照故意不同的完整样本。
 * @param connection 升级前连接。
 * @param config 运行参数及测试目录。
 * @param historicalMode 接受 Run 时的旧 Job 创建方式。
 * @param status 需保留的运行状态。
 * @param archived 是否归档父 Job。
 * @returns 原始历史对象与稳定 ID，供升级后逐字段比较。
 * @throws Error 插入或约束失败。
 */
export function seedLegacyRun(
  connection: Database.Database,
  config: AppConfig,
  historicalMode: Target['createMode'],
  status: 'queued' | 'recovering' | 'succeeded',
  archived = false,
) {
  const db = drizzle(connection);
  const instance = db
    .insert(instances)
    .values({
      id: randomUUID(),
      name: 'Historical instance',
      baseUrl: 'http://fixture',
      authMode: 'token',
      secretEnc: 'instance-ciphertext',
      accountBasePath: '/',
      accountRole: 2,
      accountPermissions: 255,
      createdAt: 1,
      updatedAt: 2,
    })
    .returning()
    .get();
  const job = mergeJob({
    name: 'Historical job',
    source: { instanceId: instance.id, path: '/source' },
    targets: Array.from(
      { length: 12 },
      /** 创建超过十个目标以识别按字符串下标排序的错误。
       * @param unused 未使用的数组元素。
       * @param index 目标位置。
       * @returns 合法目标输入。
       * @throws 不适用。
       */
      (unused, index) => ({
        instanceId: instance.id,
        path: `/target-${index}`,
      }),
    ),
  }).job;
  const {
    retryCount: _retryCount,
    sourceDownloadConcurrency: _sourceQuota,
    sourceScanIntervalSeconds: _sourceInterval,
    ...jobWithoutRetryCount
  } = job;
  const historicalJob = {
    ...jobWithoutRetryCount,
    createMode: historicalMode,
    targets: job.targets.map(
      /** 生成旧数据库实际存储的 Target 形状。
       * @param target 新的规范目标。
       * @returns 不含创建方式的旧目标。
       * @throws 不适用。
       */
      ({
        createMode: _mode,
        concurrentFiles: _files,
        chunkConcurrency: _chunks,
        scanIntervalSeconds: _scanInterval,
        ...target
      }) => target,
    ),
  };
  const currentMode = historicalMode === 'relay' ? 'server_copy' : 'relay';
  connection
    .prepare(
      `INSERT INTO jobs
    (id, name, source_instance_id, source_path, source_password_enc,
     include_globs_json, exclude_globs_json, create_mode, archived_at, created_at, updated_at)
    VALUES (?, 'Current job', ?, '/changed-source', 'source-ciphertext', '[]', '[]', ?, ?, 1, 2)`,
    )
    .run(job.id, instance.id, currentMode, archived ? 3 : null);
  for (const target of job.targets)
    connection
      .prepare(
        `INSERT INTO job_targets
      (id, job_id, instance_id, path, password_enc, position, delete_limits_enabled, archived_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'target-ciphertext', ?, 0, ?, 1, 2)`,
      )
      .run(
        target.id,
        job.id,
        instance.id,
        `/changed-${target.position}`,
        target.position,
        target.position === 0 ? 3 : null,
      );
  const runId = randomUUID();
  const frozenInstance = {
    ...instanceSnapshot(instance),
    limits: {
      maxApiConcurrency: 4,
      apiRequestsPerSecond: 5,
      maxOutstandingTasks: 4,
      maxDownloadConnections: 2,
      maxUploadSessions: 2,
      maxChunkConcurrency: 4,
    },
  };
  const snapshot = {
    snapshotVersion: 1,
    job: historicalJob,
    instances: { [instance.id]: frozenInstance },
    settings: config.execution,
  };
  connection
    .prepare(
      `INSERT INTO runs
    (id, job_id, trigger, dry_run, confirm_deletes, status, run_config_json, secret_snapshot_enc,
     stats_json, created_at, updated_at, queue_deadline_at, ended_at)
    VALUES (?, ?, 'manual', 0, 0, ?, ?, 'run-ciphertext', ?, 1, 2, 100, ?)`,
    )
    .run(
      runId,
      job.id,
      status,
      JSON.stringify(snapshot),
      JSON.stringify(emptyStats()),
      status === 'succeeded' ? 3 : null,
    );
  const targetSnapshots = historicalJob.targets.map(
    /** 写入独立 Run Target 快照及一个已有 Operation。
     * @param target 接受时的旧目标。
     * @returns 原始快照与 Run Target ID。
     * @throws Error SQLite 写入失败。
     */
    (target) => {
      const id = randomUUID();
      const value = { target, instance: frozenInstance };
      connection
        .prepare(
          `INSERT INTO run_targets
        (id, run_id, target_id, target_snapshot_json, stats_json, block_reasons_json)
        VALUES (?, ?, ?, ?, ?, '[]')`,
        )
        .run(
          id,
          runId,
          target.id,
          JSON.stringify(value),
          JSON.stringify(emptyStats()),
        );
      const operation = {
        id: randomUUID(),
        runId,
        runTargetId: id,
        seq: target.position + 1,
        action: 'create',
        method: historicalMode,
        reason: 'new',
        status: 'pending',
        sourceInstanceId: instance.id,
        sourcePath: '/source/file.txt',
        targetInstanceId: instance.id,
        targetPath: target.path + '/file.txt',
        isDir: false,
        affectedFileCount: 1,
        affectedBytes: 12,
        openlistTaskId: historicalMode === 'server_copy' ? `task-${id}` : null,
        multipartUploadId: historicalMode === 'relay' ? `upload-${id}` : null,
        createdAt: 1,
        updatedAt: 2,
      };
      const entries = Object.entries(operation).map(
        ([key, value]) =>
          [
            key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
            value,
          ] as const,
      );
      connection
        .prepare(
          `INSERT INTO operations (${entries.map(([key]) => key).join(',')}) VALUES (${entries.map(() => '?').join(',')})`,
        )
        .run(
          ...entries.map(([, value]) =>
            typeof value === 'boolean' ? Number(value) : value,
          ),
        );
      return { id, value };
    },
  );
  return { job, runId, snapshot, targetSnapshots, currentMode };
}
