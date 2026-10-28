// 验证生产迁移入口原子保留当前配置、历史快照、外键和操作责任。
import Database from 'better-sqlite3';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { eq, sql, getTableColumns } from 'drizzle-orm';
import { operations } from '../src/database/operation-schema.js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { AppConfig } from '../src/configuration/app-config.js';
import { DatabaseService } from '../src/database/database.service.js';
import { jobTargets, jobs } from '../src/database/job-schema.js';
import { instances } from '../src/database/schema.js';
import { runs, runTargets } from '../src/database/run-schema.js';
import { temporaryDirectory, environmentFor } from './helpers.js';
import type { TestDirectory } from './helpers.js';
import {
  legacyDatabase,
  seedLegacyRun,
} from './target-mode-migration-fixture.js';

/** 注册迁移升级与失败回滚验收。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('per-Target create mode migration', () => {
  let directory: TestDirectory;
  let config: AppConfig;
  let service: DatabaseService;
  /** 每例仅创建独立临时数据库。
   * @param 不适用。
   * @returns 临时配置就绪。
   * @throws Error 临时目录创建失败。
   */
  beforeEach(async () => {
    directory = await temporaryDirectory();
    config = new AppConfig(
      new ConfigService({ environment: environmentFor(directory.path) }),
    );
    service = new DatabaseService(config);
  });
  /** 关闭数据库后删除测试拥有的目录。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 资源释放失败。
   */
  afterEach(async () => {
    service.onApplicationShutdown();
    await directory.remove();
  });
  /** 从空库安装与重复启动均只使用新形状，外键始终恢复。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('installs the canonical schema and restores FK enforcement on every startup', () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      service.onModuleInit();
      expect(
        service.db.all(
          sql`SELECT name FROM pragma_table_info('jobs') WHERE name = 'create_mode'`,
        ),
      ).toEqual([]);
      expect(
        service.db.all(
          sql`SELECT name FROM pragma_table_info('job_targets') WHERE name = 'create_mode'`,
        ),
      ).toHaveLength(1);
      expect(service.db.get(sql`PRAGMA foreign_keys`)).toEqual({
        foreign_keys: 1,
      });
      service.onApplicationShutdown();
    }
  });
  /** 同时覆盖两个历史模式、归档成员及非终态 Run，保持时间与操作原值。
   * @param status 原运行状态。
   * @returns 不适用。
   * @throws Error 断言或迁移失败。
   */
  it.each(['queued', 'recovering', 'succeeded'] as const)(
    'rewrites %s history from each Run rather than current configuration',
    (status) => {
      const old = legacyDatabase(directory.path);
      const samples = [
        seedLegacyRun(old, config, 'server_copy', status),
        seedLegacyRun(old, config, 'relay', 'succeeded', true),
      ];
      const oldOperations = old
        .prepare(
          `SELECT ${Object.values(getTableColumns(operations))
            .map((column) => column.name)
            .join(',')} FROM operations ORDER BY id`,
        )
        .all();
      old.close();
      service.onModuleInit();
      for (const sample of samples) {
        const { createMode, ...historicalJob } = sample.snapshot.job;
        const expectedTargets = historicalJob.targets.map(
          /** 只为历史目标增加其 Run 的原始创建方式。
           * @param target 原目标。
           * @returns 新规范目标。
           * @throws 不适用。
           */
          (target) => ({
            ...target,
            createMode,
            concurrentFiles: createMode === 'server_copy' ? 4 : 2,
            chunkConcurrency: 2,
            scanIntervalSeconds: 0,
          }),
        );
        const run = service.db
          .select()
          .from(runs)
          .where(eq(runs.id, sample.runId))
          .get();
        expect(run?.config).toEqual({
          ...sample.snapshot,
          job: {
            ...historicalJob,
            sourceDownloadConcurrency: 2,
            sourceScanIntervalSeconds: 0,
            retryCount: null,
            targets: expectedTargets,
          },
          instances: Object.fromEntries(
            Object.entries(sample.snapshot.instances).map(
              ([id, { limits: _limits, ...instance }]) => [id, instance],
            ),
          ),
        });
        expect(run).toMatchObject({
          createdAt: 1,
          updatedAt: 2,
          secretSnapshotEnc: 'run-ciphertext',
        });
        for (const original of sample.targetSnapshots) {
          const target = service.db
            .select()
            .from(runTargets)
            .where(eq(runTargets.id, original.id))
            .get();
          expect(target?.config).toEqual({
            ...original.value,
            instance: instanceSnapshotWithoutLimits(original.value.instance),
            target: {
              ...original.value.target,
              createMode,
              concurrentFiles: createMode === 'server_copy' ? 4 : 2,
              chunkConcurrency: 2,
              scanIntervalSeconds: 0,
            },
          });
        }
        const current = service.db
          .select()
          .from(jobTargets)
          .where(eq(jobTargets.jobId, sample.job.id))
          .all();
        expect(current).toHaveLength(12);
        for (const target of current)
          expect(target).toMatchObject({
            createMode: sample.currentMode,
            passwordEnc: 'target-ciphertext',
            createdAt: 1,
            updatedAt: 2,
          });
        expect(
          current.find((target) => target.id === sample.job.targets[0].id)
            ?.archivedAt,
        ).toBe(3);
        expect(
          service.db
            .select()
            .from(jobs)
            .where(eq(jobs.id, sample.job.id))
            .get(),
        ).not.toHaveProperty('createMode');
      }
      expect(service.db.all(sql`SELECT * FROM operations ORDER BY id`)).toEqual(
        oldOperations,
      );
      expect(service.db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(service.db.get(sql`PRAGMA foreign_keys`)).toEqual({
        foreign_keys: 1,
      });
      expect(
        service.db
          .select()
          .from(instances)
          .where(eq(instances.id, samples[0].snapshot.job.source.instanceId))
          .get(),
      ).toMatchObject({
        secretEnc: 'instance-ciphertext',
        baseUrl: 'http://fixture',
      });
      expect(
        service.db.all(
          sql`SELECT name FROM pragma_index_list('instances') ORDER BY name`,
        ),
      ).toEqual([
        { name: 'instances_archive_created_id' },
        { name: 'sqlite_autoindex_instances_1' },
      ]);
      expect(
        service.db.all(
          sql`SELECT name FROM pragma_index_list('jobs') ORDER BY name`,
        ),
      ).toEqual([
        { name: 'jobs_enabled_archive' },
        { name: 'jobs_source' },
        { name: 'sqlite_autoindex_jobs_1' },
      ]);
      expect(
        service.db.all(
          sql`SELECT name FROM pragma_table_info('instances') WHERE name IN ('max_api_concurrency', 'api_requests_per_second')`,
        ),
      ).toEqual([]);
      expect(() =>
        service.db.run(sql`UPDATE job_targets SET instance_id = 'missing'`),
      ).toThrow();
      expect(() =>
        service.db.run(sql`UPDATE job_targets SET create_mode = 'invalid'`),
      ).toThrow();
    },
  );
  /** 历史清理先删子表再删 Run，停机窗口留下的终态 Run 仍可升级。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言或迁移失败。
   */
  it('rewrites terminal history whose Target rows were already removed by retention', () => {
    const old = legacyDatabase(directory.path);
    const sample = seedLegacyRun(old, config, 'server_copy', 'succeeded');
    old.exec('DELETE FROM operations; DELETE FROM run_targets');
    old.close();
    service.onModuleInit();
    const run = service.db
      .select()
      .from(runs)
      .where(eq(runs.id, sample.runId))
      .get();
    expect(run?.config.job).not.toHaveProperty('createMode');
    expect(run?.config.job.retryCount).toBeNull();
    expect(run?.config.job.targets).toEqual(
      sample.snapshot.job.targets.map(
        /** 仅转换剩余的完整历史配置，不重建被保留策略删除的子记录。
         * @param target 原始历史目标。
         * @returns 逐目标创建方式的新形状。
         * @throws 不适用。
         */
        (target) => ({
          ...target,
          createMode: 'server_copy',
          concurrentFiles: 4,
          chunkConcurrency: 2,
          scanIntervalSeconds: 0,
        }),
      ),
    );
    expect(service.db.select().from(runTargets).all()).toEqual([]);
  });
  /** 非规范快照必须中止整个升级，不能写入默认值或留下部分新结构。
   * @param corruption 破坏旧数据的测试语句。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it.each([
    "UPDATE runs SET run_config_json = json_set(run_config_json, '$.instances', json('{}'))",
    "UPDATE runs SET run_config_json = json_set(run_config_json, '$.job.sourceDownloadConcurrency', 2)",
    "UPDATE run_targets SET target_snapshot_json = json_remove(target_snapshot_json, '$.instance.limits.maxUploadSessions')",
    "UPDATE run_targets SET target_snapshot_json = json_set(target_snapshot_json, '$.instance.limits.maxChunkConcurrency', -1)",
    "UPDATE run_targets SET target_snapshot_json = json_set(target_snapshot_json, '$.instance.limits.maxDownloadConnections', '2')",
    "UPDATE runs SET run_config_json = json_set(run_config_json, '$.job.targets[1]', json_extract(run_config_json, '$.job.targets[0]'))",
    "UPDATE runs SET run_config_json = json_remove(run_config_json, '$.job.createMode')",
    "UPDATE runs SET run_config_json = json_set(run_config_json, '$.job.createMode', null)",
    "UPDATE runs SET run_config_json = json_set(run_config_json, '$.job.createMode', 'automatic')",
    "UPDATE runs SET run_config_json = json_set(run_config_json, '$.snapshotVersion', 2)",
    "UPDATE runs SET run_config_json = json_set(run_config_json, '$.job.targets', json('{}'))",
    "UPDATE runs SET run_config_json = json_set(run_config_json, '$.job.targets[0]', null)",
    "UPDATE runs SET run_config_json = json_remove(run_config_json, '$.job.targets[0].path')",
    "UPDATE run_targets SET target_snapshot_json = json_remove(target_snapshot_json, '$.target.deleteLimits')",
    "UPDATE runs SET run_config_json = json_set(run_config_json, '$.job.targets[0].createMode', 'relay')",
    "UPDATE runs SET run_config_json = json_set(run_config_json, '$.job.retryCount', 2)",
    "UPDATE run_targets SET target_snapshot_json = json_remove(target_snapshot_json, '$.target')",
    "UPDATE run_targets SET target_snapshot_json = json_set(target_snapshot_json, '$.target.id', 'wrong')",
    "UPDATE job_targets SET instance_id = 'missing'",
  ])('rolls back unexpected structure or FK violations: %s', (corruption) => {
    const old = legacyDatabase(directory.path);
    seedLegacyRun(old, config, 'server_copy', 'queued');
    old.pragma('foreign_keys = OFF');
    old.exec(corruption);
    const beforeRuns = old.prepare('SELECT * FROM runs').all();
    const beforeTargets = old.prepare('SELECT * FROM run_targets').all();
    old.close();
    expect(() => service.onModuleInit()).toThrow(
      'Database initialization or migration failed',
    );
    const reopened = new Database(join(directory.path, 'app.sqlite'));
    try {
      expect(reopened.prepare('SELECT * FROM runs').all()).toEqual(beforeRuns);
      expect(reopened.prepare('SELECT * FROM run_targets').all()).toEqual(
        beforeTargets,
      );
      expect(
        reopened
          .prepare('SELECT count(*) AS n FROM __drizzle_migrations')
          .get(),
      ).toEqual({ n: 4 });
      expect(
        reopened
          .prepare(
            "SELECT name FROM pragma_table_info('jobs') WHERE name = 'create_mode'",
          )
          .all(),
      ).toHaveLength(1);
      expect(
        reopened
          .prepare(
            "SELECT name FROM pragma_table_info('job_targets') WHERE name = 'create_mode'",
          )
          .all(),
      ).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  /** 配额升级使用各自原值；当前Instance变化不得覆盖冻结历史。
   * @param oldChunk 旧实例分片并发。
   * @param expected 新单文件分片并发。
   * @returns 验证完成。
   * @throws Error SQL或断言失败。
   */
  it.each([
    [0, 2],
    [1, 1],
    [2, 2],
    [8, 2],
  ])(
    'maps old chunk %i to %i and preserves frozen quotas',
    (oldChunk, expected) => {
      const old = legacyDatabase(directory.path);
      const sample = seedLegacyRun(old, config, 'relay', 'queued');
      old.pragma('foreign_keys = OFF');
      old.transaction(() => {
        for (const migration of readMigrationFiles({
          migrationsFolder: 'drizzle',
        }).slice(4, 6)) {
          for (const statement of migration.sql) old.exec(statement);
          old
            .prepare(
              'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
            )
            .run(migration.hash, migration.folderMillis);
        }
      })();
      const id = sample.job.source.instanceId;
      old
        .prepare(
          'UPDATE instances SET max_download_connections=6, max_upload_sessions=7, max_outstanding_tasks=11, max_chunk_concurrency=?',
        )
        .run(oldChunk);
      const frozen = sample.snapshot.instances[id];
      frozen.limits.maxDownloadConnections = 10;
      frozen.limits.maxUploadSessions = 9;
      frozen.limits.maxChunkConcurrency = oldChunk;
      old
        .prepare(
          'UPDATE runs SET run_config_json=json_set(run_config_json, ?, json(?))',
        )
        .run(`$.instances."${id}"`, JSON.stringify(frozen));
      for (const target of sample.targetSnapshots)
        old
          .prepare(
            "UPDATE run_targets SET target_snapshot_json=json_set(target_snapshot_json, '$.instance', json(?)) WHERE id=?",
          )
          .run(JSON.stringify(frozen), target.id);
      old.close();
      service.onModuleInit();
      expect(
        service.db.select().from(jobs).get()?.sourceDownloadConcurrency,
      ).toBe(6);
      expect(
        service.db
          .select()
          .from(jobTargets)
          .all()
          .every(
            (target) =>
              target.concurrentFiles === 11 &&
              target.chunkConcurrency === expected,
          ),
      ).toBe(true);
      const run = service.db.select().from(runs).get();
      expect(run?.config.job.sourceDownloadConcurrency).toBe(10);
      expect(
        run?.config.job.targets.every(
          (target) =>
            target.concurrentFiles === 9 &&
            target.chunkConcurrency === expected,
        ),
      ).toBe(true);
      expect(run?.config.instances[id]).not.toHaveProperty('limits');
      expect(
        service.db
          .select()
          .from(runTargets)
          .all()
          .every(
            (target) =>
              target.config.target.concurrentFiles === 9 &&
              target.config.target.chunkConcurrency === expected,
          ),
      ).toBe(true);
    },
  );
});

/** 去掉历史快照的旧配额，验证其余身份原样保留。
 * @param instance 迁移前的完整实例对象。
 * @returns 仅删除 limits 的实例。
 * @throws 不适用。
 */
function instanceSnapshotWithoutLimits<T extends { limits: unknown }>(
  instance: T,
): Omit<T, 'limits'> {
  const { limits: _limits, ...rest } = instance;
  return rest;
}
