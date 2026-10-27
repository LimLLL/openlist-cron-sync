// 从紧邻升级前的真实数据库验证扫描间隔迁移，保留旧快照、归档数据和外键。
import Database from 'better-sqlite3';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { AppConfig } from '../src/configuration/app-config.js';
import { DatabaseService } from '../src/database/database.service.js';
import { object } from '../src/openlist/errors.js';
import { temporaryDirectory, environmentFor } from './helpers.js';
import {
  legacyDatabase,
  seedLegacyRun,
} from './target-mode-migration-fixture.js';

/** 将原始夹具升级至发布的 0006，之后仅测试本次迁移。
 * @param connection 测试数据库。
 * @returns 不适用。
 * @throws Error 原始迁移失败。
 */
function throughPreviousRelease(connection: Database.Database): void {
  connection.pragma('foreign_keys = OFF');
  connection.transaction(() => {
    for (const migration of readMigrationFiles({
      migrationsFolder: 'drizzle',
    }).slice(4, 7)) {
      for (const statement of migration.sql) connection.exec(statement);
      connection
        .prepare(
          'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
        )
        .run(migration.hash, migration.folderMillis);
    }
  })();
}

/** 当前配置与冻结配置不同，且终态可能无子记录；所有行只增加零间隔并删除旧限额。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error SQL、迁移或断言失败。
 */
it('upgrades previous-release queued/recovering/terminal snapshots and archived configuration', async () => {
  const directory = await temporaryDirectory();
  const config = new AppConfig(
    new ConfigService({ environment: environmentFor(directory.path) }),
  );
  const service = new DatabaseService(config);
  try {
    const old = legacyDatabase(directory.path);
    const samples = [
      seedLegacyRun(old, config, 'relay', 'queued'),
      seedLegacyRun(old, config, 'server_copy', 'recovering'),
      seedLegacyRun(old, config, 'relay', 'succeeded', true),
    ];
    throughPreviousRelease(old);
    old
      .prepare('DELETE FROM operations WHERE run_id = ?')
      .run(samples[2].runId);
    old
      .prepare('DELETE FROM run_targets WHERE run_id = ?')
      .run(samples[2].runId);
    old.exec(
      'UPDATE instances SET max_api_concurrency = 77, api_requests_per_second = 88',
    );
    const before = old
      .prepare('SELECT id, run_config_json AS config FROM runs')
      .all();
    old.close();
    service.onModuleInit();
    for (const value of before) {
      const row = object(value);
      const original = object(JSON.parse(String(row.config)));
      const job = object(original.job);
      const instances = object(original.instances);
      if (!Array.isArray(job.targets)) throw new Error('Missing targets');
      const expected = {
        ...original,
        job: {
          ...job,
          sourceScanIntervalSeconds: 0,
          targets: job.targets.map((target) => ({
            ...object(target),
            scanIntervalSeconds: 0,
          })),
        },
        instances: Object.fromEntries(
          Object.entries(instances).map(([id, value]) => {
            const { limits: _limits, ...instance } = object(value);
            return [id, instance];
          }),
        ),
      };
      const current = object(
        service.db.get(
          sql`SELECT run_config_json AS config FROM runs WHERE id = ${row.id}`,
        ),
      );
      expect(JSON.parse(String(current.config))).toEqual(expected);
    }
    expect(
      service.db.all(
        sql`SELECT DISTINCT source_scan_interval_seconds AS value FROM jobs`,
      ),
    ).toEqual([{ value: 0 }]);
    expect(
      service.db.all(
        sql`SELECT DISTINCT scan_interval_seconds AS value FROM job_targets`,
      ),
    ).toEqual([{ value: 0 }]);
    expect(
      service.db.all(
        sql`SELECT name FROM pragma_table_info('instances') WHERE name IN ('max_api_concurrency', 'api_requests_per_second')`,
      ),
    ).toEqual([]);
    expect(
      service.db.all(
        sql`SELECT 1 FROM run_targets WHERE json_type(target_snapshot_json, '$.instance.limits') IS NOT NULL OR json_extract(target_snapshot_json, '$.target.scanIntervalSeconds') != 0`,
      ),
    ).toEqual([]);
    for (const value of [-1, 1.5, 3601]) {
      expect(() =>
        service.db.run(
          sql`UPDATE jobs SET source_scan_interval_seconds = ${value}`,
        ),
      ).toThrow();
      expect(() =>
        service.db.run(
          sql`UPDATE job_targets SET scan_interval_seconds = ${value}`,
        ),
      ).toThrow();
    }
    service.db.run(sql`UPDATE jobs SET source_scan_interval_seconds = 3600`);
    service.db.run(sql`UPDATE job_targets SET scan_interval_seconds = 3600`);
    expect(service.db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    expect(service.db.get(sql`PRAGMA foreign_keys`)).toEqual({
      foreign_keys: 1,
    });
    service.onApplicationShutdown();
    service.onModuleInit();
    expect(
      service.db.all(
        sql`SELECT DISTINCT source_scan_interval_seconds AS value FROM jobs`,
      ),
    ).toEqual([{ value: 3600 }]);
  } finally {
    service.onApplicationShutdown();
    await directory.remove();
  }
});

/** 本次结构变更与快照数据变更必须一同回滚，不能留下半升级的实例表。
 * @param corruption 快照结构或外键故障。
 * @returns 验证完成。
 * @throws Error SQL 或断言失败。
 */
it.each([
  "UPDATE runs SET run_config_json = json_set(run_config_json, '$.job.targets', json('{}'))",
  "UPDATE run_targets SET target_snapshot_json = json_remove(target_snapshot_json, '$.instance')",
  "UPDATE job_targets SET instance_id = 'missing'",
])(
  'rolls back this upgrade on invalid persisted data: %s',
  async (corruption) => {
    const directory = await temporaryDirectory();
    const config = new AppConfig(
      new ConfigService({ environment: environmentFor(directory.path) }),
    );
    const service = new DatabaseService(config);
    try {
      const old = legacyDatabase(directory.path);
      seedLegacyRun(old, config, 'relay', 'queued');
      throughPreviousRelease(old);
      old.exec(corruption);
      const before = old.prepare('SELECT * FROM runs').all();
      old.close();
      expect(() => service.onModuleInit()).toThrow(
        'Database initialization or migration failed',
      );
      const reopened = new Database(join(directory.path, 'app.sqlite'));
      try {
        expect(reopened.prepare('SELECT * FROM runs').all()).toEqual(before);
        expect(
          reopened
            .prepare('SELECT count(*) AS n FROM __drizzle_migrations')
            .get(),
        ).toEqual({ n: 7 });
        expect(
          reopened
            .prepare(
              "SELECT name FROM pragma_table_info('instances') WHERE name = 'max_api_concurrency'",
            )
            .all(),
        ).toHaveLength(1);
        expect(
          reopened
            .prepare(
              "SELECT name FROM pragma_table_info('jobs') WHERE name = 'source_scan_interval_seconds'",
            )
            .all(),
        ).toEqual([]);
      } finally {
        reopened.close();
      }
    } finally {
      service.onApplicationShutdown();
      await directory.remove();
    }
  },
);
