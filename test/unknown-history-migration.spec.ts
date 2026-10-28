// 从真实旧版结构验证未知历史升级、依赖保留和整组迁移回滚。
import Database from 'better-sqlite3';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { sql } from 'drizzle-orm';
import { AppConfig } from '../src/configuration/app-config.js';
import { DatabaseService } from '../src/database/database.service.js';
import { object } from '../src/openlist/errors.js';
import { environmentFor, temporaryDirectory } from './helpers.js';
import {
  legacyDatabase,
  seedLegacyRun,
} from './target-mode-migration-fixture.js';

const REMOVED = [
  'caused_by_operation_id',
  'unknown_until',
  'quarantine_released_at',
  'quarantine_release_reason',
  'reobserved_at',
  'reobserved_by_run_id',
  'resolution_kind',
  'resolution_note',
  'resolved_at',
  'resolved_by_run_id',
];

/** 将历史夹具升级至紧邻本次变更的 0009，并写入当时存在的设置。
 * @param db 测试专用旧库。
 * @returns 不适用。
 * @throws Error 原始迁移执行失败。
 */
function previousRelease(db: Database.Database): void {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (const migration of readMigrationFiles({
      migrationsFolder: 'drizzle',
    }).slice(4, 10)) {
      for (const statement of migration.sql) db.exec(statement);
      db.prepare(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
      ).run(migration.hash, migration.folderMillis);
    }
    db.exec(
      "UPDATE runs SET run_config_json = json_set(run_config_json, '$.settings.quarantineSeconds', 86400)",
    );
  })();
  db.pragma('foreign_keys = ON');
}

/** 从旧库已有行构造一条真实旧结构记录，字段名只来自测试数据库。
 * @param db 旧库连接。
 * @param row 待复制的原始行及修改字段。
 * @returns 不适用。
 * @throws Error SQLite 约束失败。
 */
function insertLegacyOperation(
  db: Database.Database,
  row: Record<string, unknown>,
): void {
  const fields = Object.keys(row);
  db.prepare(
    `INSERT INTO operations (${fields.map((field) => `"${field}"`).join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
  ).run(...fields.map((field) => row[field]));
}

/** 各类 Run 的冻结配置、操作事实和引用在升级后保持，只删除已批准的退役字段。
 * @returns 升级、重复启动与约束验证完成。
 * @throws Error 迁移或断言失败。
 */
it('preserves unknown history, legacy maintenance, dependencies and frozen snapshots while allowing reused upload IDs', async () => {
  const directory = await temporaryDirectory();
  const config = new AppConfig(
    new ConfigService({ environment: environmentFor(directory.path) }),
  );
  const service = new DatabaseService(config);
  try {
    const old = legacyDatabase(directory.path);
    const queued = seedLegacyRun(old, config, 'relay', 'queued');
    const recovering = seedLegacyRun(old, config, 'server_copy', 'recovering');
    const pruned = seedLegacyRun(old, config, 'relay', 'succeeded', true);
    previousRelease(old);
    old.prepare('DELETE FROM operations WHERE run_id=?').run(pruned.runId);
    old.prepare('DELETE FROM run_targets WHERE run_id=?').run(pruned.runId);
    const roots = old
      .prepare('SELECT * FROM operations WHERE run_id=? ORDER BY seq')
      .all(queued.runId)
      .map(object);
    const first = roots[0];
    const second = roots[1];
    old
      .prepare(
        `UPDATE operations SET status='unknown', ended_at=4, unknown_since=4, unknown_until=86400004,
      quarantine_released_at=5, quarantine_release_reason='Old decision', reobserved_at=6, reobserved_by_run_id=?,
      resolution_kind='observed', resolved_at=7, resolved_by_run_id=? WHERE id=?`,
      )
      .run(recovering.runId, recovering.runId, first.id);
    old
      .prepare('UPDATE operations SET retry_of=?, attempt_no=2 WHERE id=?')
      .run(first.id, second.id);
    old
      .prepare(
        'INSERT INTO operation_dependencies (operation_id,depends_on_id) VALUES (?,?)',
      )
      .run(second.id, first.id);
    const original = object(
      old
        .prepare('SELECT * FROM operations WHERE run_id=? ORDER BY seq LIMIT 1')
        .get(recovering.runId),
    );
    const maintenanceId = randomUUID();
    insertLegacyOperation(old, {
      ...original,
      id: maintenanceId,
      seq: 13,
      status: 'unknown',
      ended_at: 4,
      unknown_since: 4,
      unknown_until: 86400004,
      openlist_task_id: null,
      caused_by_operation_id: original.id,
      error_code: 'REMOTE_TASK_CHANGED',
      error_message: 'Remote copy task restarted',
    });
    const beforeRuns = old
      .prepare('SELECT * FROM runs ORDER BY id')
      .all()
      .map(object);
    const beforeOps = old
      .prepare('SELECT * FROM operations ORDER BY id')
      .all()
      .map(object);
    const beforeTargets = old
      .prepare('SELECT * FROM run_targets ORDER BY id')
      .all();
    const beforeEdges = old
      .prepare('SELECT * FROM operation_dependencies')
      .all();
    old.close();

    service.onModuleInit();
    const db = service.db;
    expect(db.all(sql`SELECT * FROM run_targets ORDER BY id`)).toEqual(
      beforeTargets,
    );
    expect(db.all(sql`SELECT * FROM operation_dependencies`)).toEqual(
      beforeEdges,
    );
    expect(db.all(sql`SELECT * FROM operations ORDER BY id`)).toEqual(
      beforeOps.map((row) =>
        Object.fromEntries(
          Object.entries(row).filter(([key]) => !REMOVED.includes(key)),
        ),
      ),
    );
    expect(
      db
        .all(sql`SELECT * FROM runs ORDER BY id`)
        .map(object)
        .map((row) => ({
          ...row,
          run_config_json: JSON.parse(String(row.run_config_json)),
        })),
    ).toEqual(
      beforeRuns.map((row) => {
        const snapshot = object(JSON.parse(String(row.run_config_json)));
        const settings = { ...object(snapshot.settings) };
        delete settings.quarantineSeconds;
        return {
          ...row,
          retry_of_run_id: null,
          run_config_json: { ...snapshot, settings },
        };
      }),
    );
    const columns = db
      .all<{ name: string }>(sql`PRAGMA table_info(operations)`)
      .map((row) => row.name);
    for (const field of REMOVED) expect(columns).not.toContain(field);
    // 相同 session 允许出现在不同历史尝试，单个操作的事实仍单独保存。
    db.run(
      sql`UPDATE operations SET multipart_upload_id=${first.multipart_upload_id} WHERE id=${second.id}`,
    );
    expect(
      db.get<{ n: number }>(
        sql`SELECT count(*) AS n FROM operations WHERE multipart_upload_id=${first.multipart_upload_id}`,
      )?.n,
    ).toBe(2);
    expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    expect(db.get(sql`PRAGMA foreign_keys`)).toEqual({ foreign_keys: 1 });
    expect(db.get(sql`PRAGMA integrity_check`)).toEqual({
      integrity_check: 'ok',
    });
    service.onApplicationShutdown();
    service.onModuleInit();
    expect(db === service.db).toBe(false);
    expect(
      service.db.get(
        sql`SELECT error_code FROM operations WHERE id=${maintenanceId}`,
      ),
    ).toEqual({ error_code: 'REMOTE_TASK_CHANGED' });
  } finally {
    service.onApplicationShutdown();
    await directory.remove();
  }
});

/** 快照或引用损坏时结构、数据和迁移位置必须一起回滚。
 * @param corruption 在旧库注入的单个不一致。
 * @returns 升级失败且旧库原样保留。
 * @throws Error 断言失败。
 */
it.each([
  "UPDATE runs SET run_config_json = json_set(run_config_json, '$.settings', json('[]'))",
  "UPDATE operations SET retry_of='missing-operation'",
  "INSERT INTO operation_dependencies (operation_id,depends_on_id) SELECT id,'missing-dependency' FROM operations LIMIT 1",
])('rolls back the complete upgrade for %s', async (corruption) => {
  const directory = await temporaryDirectory();
  const config = new AppConfig(
    new ConfigService({ environment: environmentFor(directory.path) }),
  );
  const service = new DatabaseService(config);
  try {
    const old = legacyDatabase(directory.path);
    seedLegacyRun(old, config, 'relay', 'queued');
    previousRelease(old);
    old.pragma('foreign_keys = OFF');
    old.exec(corruption);
    const beforeSchema = old
      .prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name')
      .all();
    const beforeRuns = old.prepare('SELECT * FROM runs').all();
    const beforeOps = old.prepare('SELECT * FROM operations').all();
    const beforeMigrations = old
      .prepare('SELECT * FROM __drizzle_migrations')
      .all();
    old.close();
    expect(() => service.onModuleInit()).toThrow(
      'Database initialization or migration failed',
    );
    const reopened = new Database(join(directory.path, 'app.sqlite'));
    try {
      expect(
        reopened
          .prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name')
          .all(),
      ).toEqual(beforeSchema);
      expect(reopened.prepare('SELECT * FROM runs').all()).toEqual(beforeRuns);
      expect(reopened.prepare('SELECT * FROM operations').all()).toEqual(
        beforeOps,
      );
      expect(
        reopened.prepare('SELECT * FROM __drizzle_migrations').all(),
      ).toEqual(beforeMigrations);
    } finally {
      reopened.close();
    }
  } finally {
    service.onApplicationShutdown();
    await directory.remove();
  }
});
