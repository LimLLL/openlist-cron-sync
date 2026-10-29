// SQLite模式转换和历史空闲页回收；压缩失败不撤销已提交的结构迁移。
import { Logger } from '@nestjs/common';
import { accessSync, constants, statSync, statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import type Database from 'better-sqlite3';

const logger = new Logger('SQLiteStorage');
/** 一次最多回收256页，只控制同步工作量，不限制本轮回收总量。 */
const RECLAIM_PAGES = 256;

/** 按SQLite unix VFS的顺序取临时目录：SQLITE_TMPDIR、TMPDIR、/var/tmp、/usr/tmp、/tmp，首个可写目录即VACUUM临时库所在处。
 * @param 不适用。
 * @returns 临时目录；都不可用时为当前目录，与SQLite一致。
 * @throws 不适用。
 */
function temporaryDirectory(): string {
  for (const candidate of [
    process.env.SQLITE_TMPDIR,
    process.env.TMPDIR,
    '/var/tmp',
    '/usr/tmp',
    '/tmp',
  ]) {
    if (!candidate) continue;
    try {
      if (!statSync(candidate).isDirectory()) continue;
      accessSync(candidate, constants.W_OK | constants.X_OK);
      return candidate;
    } catch {
      // 不存在或不可写的候选与SQLite一样跳过。
    }
  }
  return '.';
}

/** 取得库、WAL和文件系统空间；空间检查不构成磁盘预留。
 * @param db 打开的SQLite连接。
 * @returns 可安全写入日志的大小与空间事实。
 * @throws Error 文件系统或SQL读取失败。
 */
export function storageFacts(db: Database.Database) {
  const pageSize = Number(db.pragma('page_size', { simple: true }));
  const pageCount = Number(db.pragma('page_count', { simple: true }));
  const data = statfsSync(dirname(db.name));
  const temporary = statfsSync(temporaryDirectory());
  let walBytes = 0;
  try {
    walBytes = statSync(`${db.name}-wal`).size;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  return {
    databaseBytes: pageSize * pageCount,
    freePageBytes:
      pageSize * Number(db.pragma('freelist_count', { simple: true })),
    walBytes,
    dataFreeBytes: data.bavail * data.bsize,
    temporaryFreeBytes: temporary.bavail * temporary.bsize,
  };
}

/** 截断WAL但不等待外部读者，恢复调用方的busy_timeout。
 * @param db 当前连接。
 * @param phase 日志中的固定阶段。
 * @returns 本次是否完成；读者阻塞返回false并记录。
 * @throws Error 非busy的SQLite错误。
 */
export function checkpoint(db: Database.Database, phase: string): boolean {
  const started = Date.now();
  const timeout = Number(db.pragma('busy_timeout', { simple: true }));
  try {
    db.pragma('busy_timeout=0');
    const rows = db.pragma('wal_checkpoint(TRUNCATE)') as {
      busy: number;
      log: number;
      checkpointed: number;
    }[];
    if (rows[0]?.busy) {
      logger.warn(
        'SQLite checkpoint deferred; close external read transactions',
        { phase, ...storageFacts(db) },
      );
      return false;
    }
    logger.log('SQLite checkpoint completed', {
      phase,
      elapsedMs: Date.now() - started,
    });
    return true;
  } catch (error) {
    if (!(
      error instanceof Error &&
      'code' in error &&
      error.code === 'SQLITE_BUSY'
    ))
      throw error;
    logger.warn(
      'SQLite checkpoint deferred; close external read transactions',
      { phase, ...storageFacts(db) },
    );
    return false;
  } finally {
    db.pragma(`busy_timeout=${timeout}`);
  }
}

/** 在迁移已提交、外键已验证后转换旧库；正常重启不重复完整VACUUM。
 * @param db 未开放执行和HTTP的数据库连接。
 * @returns 已完成或空间不足而延期。
 * @throws Error I/O、损坏、VACUUM锁错误等不可恢复错误。
 */
export function compactDatabase(db: Database.Database): void {
  if (!checkpoint(db, 'before_compaction')) return;
  if (db.pragma('auto_vacuum', { simple: true }) === 2) return;
  const before = storageFacts(db);
  // 官方最坏额外需求为原库两倍；同时检查数据和临时卷，不承诺能抵御并发磁盘占用。
  if (
    before.dataFreeBytes < before.databaseBytes * 2 ||
    before.temporaryFreeBytes < before.databaseBytes
  ) {
    logger.warn(
      'SQLite compaction deferred; free disk space and restart to enable incremental reclamation',
      { phase: 'space_check', ...before },
    );
    return;
  }
  const previousMode = Number(db.pragma('auto_vacuum', { simple: true }));
  const started = Date.now();
  try {
    db.pragma('auto_vacuum=INCREMENTAL');
    db.exec('VACUUM');
  } catch (error) {
    if (!(
      error instanceof Error &&
      'code' in error &&
      error.code === 'SQLITE_FULL'
    ))
      throw error;
    if (db.inTransaction) db.exec('ROLLBACK');
    // 清除连接上尚未落库的模式请求；读取实际模式决定下一次启动是否重试。
    db.pragma(`auto_vacuum=${previousMode}`);
    db.prepare('SELECT count(*) FROM sqlite_schema').get();
    logger.warn('SQLite compaction rolled back; free disk space and restart', {
      phase: 'vacuum',
      elapsedMs: Date.now() - started,
      ...storageFacts(db),
    });
    return;
  }
  const elapsedMs = Date.now() - started;
  checkpoint(db, 'after_compaction');
  logger.log('SQLite compaction completed', {
    phase: 'vacuum',
    elapsedMs,
    beforeBytes: before.databaseBytes,
    ...storageFacts(db),
  });
}

/** 历史删除结束后分步归还完整空闲页，NONE模式必须跳过以避免空转。
 * @param db 单写连接。
 * @param signal 关闭广播。
 * @returns 已回收或收到关闭信号。
 * @throws Error 非busy的SQL错误或关闭信号。
 */
export async function reclaimHistory(
  db: Database.Database,
  signal: AbortSignal,
): Promise<void> {
  if (db.pragma('auto_vacuum', { simple: true }) !== 2) return;
  while (Number(db.pragma('freelist_count', { simple: true })) > 0) {
    signal.throwIfAborted();
    // pragma默认all()完整推进结果；simple/get只取首项会提前停止回收。
    db.pragma(`incremental_vacuum(${RECLAIM_PAGES})`);
    await yieldLoop(undefined, { signal });
  }
  signal.throwIfAborted();
  checkpoint(db, 'history_reclamation');
}
