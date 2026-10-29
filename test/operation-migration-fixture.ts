// 构造紧邻分层迁移的真实旧结构，并独立计算旧口径统计作为迁移对照。
import type Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import {
  legacyDatabase,
  seedLegacyRun,
} from './target-mode-migration-fixture.js';
import type { AppConfig } from '../src/configuration/app-config.js';
import { emptyStats } from '../src/sync/stats.js';

/** 升级旧夹具至0012，不运行当前分层迁移。
 * @param directory 测试目录。
 * @param config 冻结运行参数。
 * @param runCount 需要的独立Run数。
 * @returns 旧库及Run身份。
 * @throws Error SQL或迁移失败。
 */
export function operationMigrationFixture(
  directory: string,
  config: AppConfig,
  runCount = 1,
): { db: Database.Database; samples: ReturnType<typeof seedLegacyRun>[] } {
  const db = legacyDatabase(directory);
  const samples = Array.from({ length: runCount }, () =>
    seedLegacyRun(db, config, 'relay', 'succeeded'),
  );
  db.pragma('foreign_keys=OFF');
  db.transaction(() => {
    for (const migration of readMigrationFiles({
      migrationsFolder: 'drizzle',
    }).slice(4, 13)) {
      for (const statement of migration.sql) db.exec(statement);
      db.prepare(
        'INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)',
      ).run(migration.hash, migration.folderMillis);
    }
  })();
  db.pragma('foreign_keys=ON');
  return { db, samples };
}

/** 复制一个旧结构行；字段名只来自本地测试定义和真实旧库。
 * @param db 旧结构连接。
 * @param row 旧行及覆盖值。
 * @returns 不适用。
 * @throws Error SQLite约束失败。
 */
export function insertOldOperation(
  db: Database.Database,
  row: Record<string, unknown>,
): void {
  const fields = Object.keys(row);
  db.prepare(
    `INSERT INTO operations(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`,
  ).run(...fields.map((field) => row[field]));
}

/** 使用迁移前末次尝试规则计算完整Stats，作为新聚合的独立输入对照。
 * @param db 真实旧库。
 * @returns 每Target的旧口径统计。
 * @throws Error SQL或整数溢出。
 */
export function legacyStats(db: Database.Database) {
  const rows = db
    .prepare(
      `WITH old AS (
    SELECT o.*, NOT EXISTS(SELECT 1 FROM operations n WHERE n.retry_of=coalesce(o.retry_of,o.id) AND n.run_id=o.run_id AND n.target_instance_id=o.target_instance_id AND n.target_path=o.target_path AND n.attempt_no>o.attempt_no) AS latest
    FROM operations o WHERE error_code IS NOT 'REMOTE_TASK_CHANGED'
  ) SELECT run_target_id AS targetId,
    sum(latest AND status='succeeded' AND action='create') AS succeededCreates,
    sum(latest AND status='succeeded' AND action='delete' AND NOT is_dir AND reason='replace') AS deletedForReplace,
    sum(latest AND status='succeeded' AND action='delete' AND NOT is_dir AND reason='extra') AS deletedAsExtra,
    sum(latest AND status='failed') AS failedOperations, sum(latest AND status='unknown') AS unknownOperations,
    sum(latest AND status='skipped') AS skippedOperations, sum(latest AND status='cancelled') AS cancelledOperations,
    sum(retry_of IS NOT NULL) AS retryAttempts, sum(bytes_downloaded) AS downloadedBytes, sum(bytes_transferred) AS transferredBytes,
    sum(CASE WHEN status='succeeded' AND action='delete' THEN affected_bytes ELSE 0 END) AS actualDeletedBytes
    FROM old GROUP BY run_target_id`,
    )
    .all() as ({ targetId: string } & Partial<ReturnType<typeof emptyStats>>)[];
  return new Map(
    rows.map(({ targetId, ...stats }) => [
      targetId,
      { ...emptyStats(), ...stats },
    ]),
  );
}
