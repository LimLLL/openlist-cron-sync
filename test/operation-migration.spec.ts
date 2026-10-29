// 从已发布0012升级：严格拒绝坏链，验证旧ID、统计等价及生产规模磁盘峰值。
import Database from 'better-sqlite3';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { AppConfig } from '../src/configuration/app-config.js';
import { DatabaseService } from '../src/database/database.service.js';
import { OperationsService } from '../src/runs/operations.service.js';
import { runs } from '../src/database/run-schema.js';
import { liveRunResult, runResult } from '../src/sync/results.js';
import { emptyStats } from '../src/sync/stats.js';
import { environmentFor, temporaryDirectory } from './helpers.js';
import {
  operationMigrationFixture,
  insertOldOperation,
  legacyStats,
} from './operation-migration-fixture.js';

/** 创建允许十次尝试的隔离升级配置。
 * @param directory 夹具目录。
 * @returns AppConfig。
 * @throws Error 配置非法。
 */
function configFor(directory: string) {
  return new AppConfig(
    new ConfigService({
      environment: { ...environmentFor(directory), RETRY_MAX_ATTEMPTS: '10' },
    }),
  );
}

/** 在旧库创建有效两次尝试，供迁移与损坏测试共用。
 * @param db 旧数据库。
 * @returns 根和第二次尝试ID。
 * @throws Error SQL失败。
 */
function chain(db: Database.Database) {
  const root = db
    .prepare('SELECT * FROM operations ORDER BY seq LIMIT 1')
    .get() as Record<string, unknown>;
  db.prepare(
    "UPDATE operations SET status='failed',ended_at=4,error_code='OPENLIST_ERROR',multipart_chunk_size=4 WHERE id=?",
  ).run(root.id);
  const row = db
    .prepare('SELECT * FROM operations WHERE id=?')
    .get(root.id) as Record<string, unknown>;
  const retryId = randomUUID();
  insertOldOperation(db, {
    ...row,
    id: retryId,
    seq: 100,
    retry_of: root.id,
    attempt_no: 2,
    status: 'succeeded',
    error_code: null,
    error_message: null,
    bytes_downloaded: 11,
    bytes_transferred: 9,
    created_at: 5,
    updated_at: 6,
    ended_at: 6,
  });
  return { root: row, retryId };
}

/** 保留真实尝试事实，清理旧维护行及其边；正常旧URL解析为根操作。 */
it('preserves attempts and old links while removing maintenance rows and collapsing dependencies', async () => {
  const directory = await temporaryDirectory();
  const config = configFor(directory.path);
  const service = new DatabaseService(config);
  try {
    const { db } = operationMigrationFixture(directory.path, config);
    const { root, retryId } = chain(db);
    const cleanupId = randomUUID();
    const cleanup = {
      ...root,
      id: cleanupId,
      seq: 101,
      action: 'delete',
      method: 'remove',
      reason: 'retry_cleanup',
      status: 'succeeded',
      source_instance_id: null,
      source_path: null,
      expected_source_size: null,
      expected_source_modified: null,
      expected_target_size: 3,
      affected_bytes: 3,
      multipart_upload_id: null,
      multipart_chunk_size: null,
      multipart_state: null,
      multipart_attempt: null,
      source_stream_completed_at: null,
      error_code: null,
      error_message: null,
    };
    insertOldOperation(db, cleanup);
    db.prepare('INSERT INTO operation_dependencies VALUES(?,?)').run(
      root.id,
      cleanupId,
    );
    db.prepare('INSERT INTO operation_dependencies VALUES(?,?)').run(
      retryId,
      cleanupId,
    );
    const maintenanceId = randomUUID();
    insertOldOperation(db, {
      ...cleanup,
      id: maintenanceId,
      seq: 102,
      status: 'unknown',
      unknown_since: 4,
      error_code: 'REMOTE_TASK_CHANGED',
    });
    db.prepare('INSERT INTO operation_dependencies VALUES(?,?)').run(
      root.id,
      maintenanceId,
    );
    const before = legacyStats(db);
    db.close();
    service.onModuleInit();
    const api = new OperationsService(service);
    expect(api.get(retryId)).toMatchObject({
      id: root.id,
      status: 'succeeded',
      attemptCount: 2,
      bytesDownloaded: 11,
      bytesTransferred: 9,
    });
    expect(api.get(retryId).attempts.map((attempt) => attempt.id)).toEqual([
      root.id,
      retryId,
    ]);
    expect(() => api.get(maintenanceId)).toThrow('Operation not found');
    expect(service.db.all(sql`SELECT * FROM operation_dependencies`)).toEqual([
      { operation_id: root.id, depends_on_id: cleanupId },
    ]);
    const run = service.db
      .select()
      .from(runs)
      .where(eq(runs.id, String(root.run_id)))
      .get()!;
    expect(
      liveRunResult(service.db, run).targets.find(
        (target) => target.id === root.run_target_id,
      )?.stats,
    ).toEqual(before.get(String(root.run_target_id)));
    expect(
      service.db.get<{ sql: string }>(
        sql`SELECT sql FROM sqlite_schema WHERE name='operation_dependencies'`,
      )?.sql,
    ).toContain('WITHOUT ROWID');
    expect(service.db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
  } finally {
    service.onApplicationShutdown();
    await directory.remove();
  }
});

/** 损坏的业务链必须具名失败，且SQL、数据与迁移位置全部回滚。 */
it.each([
  'cross_run',
  'missing_root',
  'nested_root',
  'different_path',
  'duplicate_number',
  'swapped_numbers',
  'gap',
  'budget',
  'maintenance_responsibility',
  'dependency_cycle',
  'deep_dependency_cycle',
  'late_foreign_key',
] as const)('rejects %s without committing any upgrade', async (fault) => {
  const directory = await temporaryDirectory();
  const config = configFor(directory.path);
  const service = new DatabaseService(config);
  try {
    const { db, samples } = operationMigrationFixture(
      directory.path,
      config,
      2,
    );
    const { root, retryId } = chain(db);
    db.pragma('foreign_keys=OFF');
    if (fault === 'cross_run')
      db.prepare('UPDATE operations SET run_id=? WHERE id=?').run(
        samples.find((sample) => sample.runId !== root.run_id)!.runId,
        retryId,
      );
    if (fault === 'missing_root')
      db.prepare('UPDATE operations SET retry_of=? WHERE id=?').run(
        randomUUID(),
        retryId,
      );
    if (fault === 'nested_root')
      db.prepare('UPDATE operations SET retry_of=? WHERE id=?').run(
        retryId,
        root.id,
      );
    if (fault === 'different_path')
      db.prepare("UPDATE operations SET target_path='/other' WHERE id=?").run(
        retryId,
      );
    if (fault === 'duplicate_number')
      db.prepare('UPDATE operations SET attempt_no=1 WHERE id=?').run(retryId);
    if (fault === 'swapped_numbers') {
      db.prepare('UPDATE operations SET attempt_no=2 WHERE id=?').run(root.id);
      db.prepare('UPDATE operations SET attempt_no=1 WHERE id=?').run(retryId);
    }
    if (fault === 'gap')
      db.prepare('UPDATE operations SET attempt_no=3 WHERE id=?').run(retryId);
    if (fault === 'budget')
      db.prepare(
        "UPDATE runs SET run_config_json=json_set(run_config_json,'$.settings.retryMaxAttempts',1) WHERE id=?",
      ).run(root.run_id);
    if (fault === 'maintenance_responsibility')
      db.prepare(
        "UPDATE operations SET method='server_copy',openlist_task_id='fixture-task',remote_cleanup_pending=1,multipart_upload_id=NULL,multipart_chunk_size=NULL,multipart_state=NULL,multipart_attempt=NULL,source_stream_completed_at=NULL,error_code='REMOTE_TASK_CHANGED' WHERE id=?",
      ).run(retryId);
    if (fault === 'dependency_cycle' || fault === 'deep_dependency_cycle') {
      const edge = db.prepare('INSERT INTO operation_dependencies VALUES(?,?)');
      const depth = fault === 'deep_dependency_cycle' ? 11 : 1;
      let previous = String(root.id);
      for (let i = 0; i < depth; i++) {
        const other = randomUUID();
        insertOldOperation(db, { ...root, id: other, seq: 200 + i });
        edge.run(other, previous);
        previous = other;
      }
      // 仅这一条边指向更晚的序号，检测必须沿完整祖先链回到起点。
      edge.run(root.id, previous);
    }
    if (fault === 'late_foreign_key')
      db.prepare(
        'UPDATE operations SET source_instance_id=? WHERE id=? OR retry_of=?',
      ).run(randomUUID(), root.id, root.id);
    const before = db.prepare('SELECT * FROM operations ORDER BY id').all();
    const schema = db
      .prepare('SELECT name,sql FROM sqlite_schema ORDER BY name')
      .all();
    const migrations = db.prepare('SELECT * FROM __drizzle_migrations').all();
    db.close();
    expect(() => service.onModuleInit()).toThrow(
      fault === 'late_foreign_key'
        ? /Database initialization or migration failed/
        : /Operation migration rejected: .*row=[0-9a-f-]{36}/,
    );
    const reopened = new Database(join(directory.path, 'app.sqlite'));
    try {
      expect(
        reopened.prepare('SELECT * FROM operations ORDER BY id').all(),
      ).toEqual(before);
      expect(
        reopened
          .prepare('SELECT name,sql FROM sqlite_schema ORDER BY name')
          .all(),
      ).toEqual(schema);
      expect(
        reopened.prepare('SELECT * FROM __drizzle_migrations').all(),
      ).toEqual(migrations);
    } finally {
      reopened.close();
    }
  } finally {
    service.onApplicationShutdown();
    await directory.remove();
  }
});

/** 生产规模验收：真实旧结构与迁移、全部Stats对照、文件及打开临时库的采样峰值。
 * 约写入1.5GB临时文件并耗时数十秒，默认跳过；设置 OPERATION_MIGRATION_SCALE=1 时运行。 */
it.runIf(process.env.OPERATION_MIGRATION_SCALE === '1')(
  'migrates 309517 rows with equivalent statistics and measures disk and phase costs',
  async () => {
    const directory = await temporaryDirectory();
    const config = configFor(directory.path);
    const service = new DatabaseService(config);
    let monitor: ReturnType<typeof fork> | undefined;
    const log = vi.spyOn(Logger.prototype, 'log');
    try {
      const { db, samples } = operationMigrationFixture(
        directory.path,
        config,
        3,
      );
      const prototype = db
        .prepare('SELECT * FROM operations LIMIT 1')
        .get() as Record<string, unknown>;
      db.exec('DELETE FROM operations');
      const count = 309517,
        retries = 19632,
        roots = count - retries,
        directories = 176104,
        creates = 131711 - retries;
      const ids = Array.from({ length: roots }, () => randomUUID());
      const columns = Object.keys(prototype);
      const insert = db.prepare(
        `INSERT INTO operations(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
      );
      const now = 1793181313683;
      db.transaction(() => {
        for (let i = 0; i < count; i++) {
          const retry = i >= roots;
          const index = retry ? directories + i - roots : i;
          const sample = samples[index % samples.length];
          const isDir = index < directories;
          const create = !isDir && index < directories + creates;
          const failed = create && index < directories + retries && !retry;
          const status = failed
            ? 'failed'
            : index % 101 === 0
              ? 'unknown'
              : index % 103 === 0
                ? 'skipped'
                : index % 107 === 0
                  ? 'cancelled'
                  : 'succeeded';
          const row = {
            ...prototype,
            id: retry ? randomUUID() : ids[index],
            run_id: sample.runId,
            run_target_id: sample.targetSnapshots[0].id,
            seq: i + 1,
            action: isDir ? 'mkdir' : create ? 'create' : 'delete',
            method: isDir ? 'mkdir' : create ? 'relay' : 'remove',
            reason: isDir ? 'prepare' : create ? 'new' : 'extra',
            status,
            source_instance_id: create
              ? sample.snapshot.job.source.instanceId
              : null,
            source_path: create
              ? '/source/' +
                'directory/'.repeat(30).slice(0, 204) +
                String(index).padStart(12, '0')
              : null,
            target_instance_id: sample.snapshot.job.source.instanceId,
            target_path:
              '/target/' +
              'directory/'.repeat(25).slice(0, 154) +
              String(index).padStart(12, '0'),
            is_dir: Number(isDir),
            expected_source_size: create ? 1234567 : null,
            expected_target_size: !isDir && !create ? 98765 : null,
            expected_source_modified: create ? '2026-10-28T12:00:00Z' : null,
            affected_file_count: isDir ? 0 : 1,
            affected_bytes: isDir ? 0 : create ? 1234567 : 98765,
            retry_of: retry ? ids[index] : null,
            attempt_no: retry ? 2 : 1,
            bytes_downloaded: create ? 1234567 : 0,
            bytes_transferred: create ? 1234567 : 0,
            multipart_upload_id: create ? randomUUID() : null,
            multipart_chunk_size: create ? 4194304 : null,
            multipart_state: create
              ? failed
                ? 'failed_retriable'
                : 'completed'
              : null,
            multipart_attempt: create ? 0 : null,
            source_stream_completed_at: create ? now : null,
            error_code: status === 'succeeded' ? null : 'OPENLIST_ERROR',
            error_message: status === 'succeeded' ? null : 'fixture outcome',
            unknown_since: status === 'unknown' ? now : null,
            created_at: now,
            updated_at: now,
            submitted_at: now,
            ended_at: now,
          };
          insert.run(
            ...columns.map((column) => row[column as keyof typeof row]),
          );
        }
        const edge = db.prepare(
          'INSERT INTO operation_dependencies VALUES(?,?)',
        );
        // 每个Run用三叉目录树模拟最深11层的依赖，避免深度1夹具掩盖闭包开销。
        // 重试复制前置边，迁移后合并为逻辑边；边数与生产规模保持一致。
        for (let i = 3; i < 284992; i++) {
          const runIndex = i % 3;
          const localIndex = Math.floor(i / 3);
          const parentIndex = Math.floor((localIndex - 1) / 3) * 3 + runIndex;
          edge.run(ids[i], ids[parentIndex]);
        }
        db.exec(
          'INSERT INTO operation_dependencies SELECT o.id,p.depends_on_id FROM operations o JOIN operation_dependencies p ON p.operation_id=o.retry_of WHERE o.retry_of IS NOT NULL',
        );
      })();
      const before = legacyStats(db);
      for (const [targetId, stats] of before)
        db.prepare('UPDATE run_targets SET stats_json=? WHERE id=?').run(
          JSON.stringify(stats),
          targetId,
        );
      for (const sample of samples)
        db.prepare('UPDATE runs SET stats_json=? WHERE id=?').run(
          JSON.stringify(
            before.get(sample.targetSnapshots[0].id) ?? emptyStats(),
          ),
          sample.runId,
        );
      const frozen = db
        .prepare('SELECT id,run_config_json,stats_json FROM runs ORDER BY id')
        .all();
      db.exec('VACUUM');
      db.exec('CREATE TABLE padding(value BLOB)');
      const padding = db.prepare(
        'INSERT INTO padding VALUES(zeroblob(1048576))',
      );
      db.transaction(() => {
        for (let i = 0; i < 265; i++) padding.run();
      })();
      db.exec('DROP TABLE padding');
      const path = join(directory.path, 'app.sqlite');
      const initialBytes = statSync(path).size;
      db.close();
      monitor = fork(
        fileURLToPath(new URL('./storage-peak-monitor.cjs', import.meta.url)),
        [path],
        { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
      );
      await new Promise<void>((resolve, reject) => {
        monitor!.once('message', () => resolve());
        monitor!.once('error', reject);
        monitor!.once('exit', (code) => {
          if (code) reject(new Error(`Storage monitor exited ${code}`));
        });
      });
      const start = Date.now();
      service.onModuleInit();
      const elapsedMs = Date.now() - start;
      const peak = await new Promise<Record<string, number>>(
        (resolve, reject) => {
          monitor!.once('message', resolve);
          monitor!.once('error', reject);
          monitor!.send('stop');
        },
      );
      const current = service.db;
      expect(current.get(sql`SELECT count(*) AS n FROM operations`)).toEqual({
        n: roots,
      });
      expect(
        current.get(sql`SELECT count(*) AS n FROM operation_attempts`),
      ).toEqual({ n: count });
      expect(
        current.all(
          sql`SELECT id,run_config_json,stats_json FROM runs ORDER BY id`,
        ),
      ).toEqual(frozen);
      for (const run of current.select().from(runs).all()) {
        const live = liveRunResult(current, run),
          final = runResult(current, run);
        expect(live.stats).toEqual(final.stats);
        expect(live.stats).toEqual(run.stats);
        for (const target of live.targets)
          expect(target.stats).toEqual(before.get(target.id) ?? emptyStats());
      }
      expect(current.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(current.get(sql`PRAGMA temp.page_count`)).toEqual({
        page_count: 0,
      });
      expect(current.get(sql`PRAGMA integrity_check`)).toEqual({
        integrity_check: 'ok',
      });
      console.info(
        'OPERATION_MIGRATION_MEASUREMENT',
        JSON.stringify({
          oldRows: count,
          operations: roots,
          attempts: count,
          oldDependencies: 304621,
          dependencies: current.get<{ n: number }>(
            sql`SELECT count(*) AS n FROM operation_dependencies`,
          )!.n,
          initialBytes,
          finalBytes: statSync(path).size,
          elapsedMs,
          phases: log.mock.calls
            .filter(([message]) =>
              [
                'Database migrations completed',
                'SQLite compaction completed',
                'SQLite checkpoint completed',
              ].includes(String(message)),
            )
            .map(([, facts]) => facts),
          peak,
        }),
      );
    } finally {
      log.mockRestore();
      if (monitor?.connected) monitor.kill();
      service.onApplicationShutdown();
      await directory.remove();
    }
  },
  180000,
);
