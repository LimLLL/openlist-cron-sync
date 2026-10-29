// 使用真实SQLite及磁盘页数限制验证可恢复压缩失败、WAL阻塞和增量回收。
import Database from 'better-sqlite3';
import { statSync } from 'node:fs';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { temporaryDirectory } from './helpers.js';
import {
  compactDatabase,
  reclaimHistory,
} from '../src/database/sqlite-storage.js';

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, statfsSync: vi.fn(actual.statfsSync) };
});

/** 建立无auto-vacuum的已压紧旧库，可通过最大页数触发真正的SQLITE_FULL。
 * @param path 临时数据库文件。
 * @returns 打开的旧模式连接。
 * @throws Error SQL或文件系统失败。
 */
function oldDatabase(path: string) {
  const db = new Database(path);
  db.pragma('auto_vacuum=NONE');
  db.pragma('journal_mode=WAL');
  db.pragma('synchronous=FULL');
  db.exec('CREATE TABLE payload(id INTEGER PRIMARY KEY, value BLOB)');
  const insert = db.prepare(
    'INSERT INTO payload(value) VALUES(zeroblob(3500))',
  );
  db.transaction(() => {
    for (let i = 0; i < 1000; i++) insert.run();
  })();
  db.exec('VACUUM');
  db.pragma('wal_checkpoint(TRUNCATE)');
  return db;
}

/** VACUUM的实际FULL只撤销压缩，连接和数据仍可用；下一次打开可完成转换。 */
it('continues after native SQLITE_FULL and enables incremental mode on the next startup', async () => {
  const directory = await temporaryDirectory();
  const path = join(directory.path, 'old.sqlite');
  let db = oldDatabase(path);
  const warning = vi.spyOn(Logger.prototype, 'warn');
  try {
    const pages = Number(db.pragma('page_count', { simple: true }));
    db.pragma(`max_page_count=${pages}`);
    expect(() => compactDatabase(db)).not.toThrow();
    expect(db.inTransaction).toBe(false);
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM payload').get()).toEqual({
      n: 1000,
    });
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('rolled back'),
      expect.objectContaining({ phase: 'vacuum' }),
    );
    db.close();
    db = new Database(path);
    db.pragma('max_page_count=4294967294');
    compactDatabase(db);
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(2);
    const exec = vi.spyOn(db, 'exec');
    compactDatabase(db);
    expect(exec).not.toHaveBeenCalledWith('VACUUM');
  } finally {
    warning.mockRestore();
    db.close();
    await directory.remove();
  }
});

/** NONE模式的历史删除正常完成；空间预检不足不修改模式，也不能进入回收空转。 */
it('skips insufficient-space compaction and reclamation in NONE mode', async () => {
  const directory = await temporaryDirectory();
  const db = oldDatabase(join(directory.path, 'old.sqlite'));
  try {
    db.exec('DELETE FROM payload');
    const real = fs.statfsSync(directory.path);
    const stat = vi
      .spyOn(fs, 'statfsSync')
      .mockReturnValue({ ...real, bavail: 0 });
    try {
      compactDatabase(db);
    } finally {
      stat.mockRestore();
    }
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(0);
    const free = db.pragma('freelist_count', { simple: true });
    expect(Number(free)).toBeGreaterThan(0);
    await reclaimHistory(db, new AbortController().signal);
    expect(db.pragma('freelist_count', { simple: true })).toBe(free);
  } finally {
    db.close();
    await directory.remove();
  }
});

/** 长读事务阻塞前置checkpoint时延期转换；已转换后的回收可继续并让出事件循环。 */
it('defers a reader-blocked checkpoint and reclaims every free page in yielding steps', async () => {
  const directory = await temporaryDirectory();
  const path = join(directory.path, 'old.sqlite');
  const db = oldDatabase(path);
  const reader = new Database(path);
  try {
    reader.exec('BEGIN');
    reader.prepare('SELECT count(*) FROM payload').get();
    db.exec('INSERT INTO payload(value) VALUES(zeroblob(3500))');
    compactDatabase(db);
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(0);
    reader.exec('ROLLBACK');
    compactDatabase(db);
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(2);
    const before = statSync(path).size;
    db.exec('DELETE FROM payload');
    let yielded = false;
    setImmediate(() => {
      yielded = true;
    });
    await reclaimHistory(db, new AbortController().signal);
    expect(yielded).toBe(true);
    expect(db.pragma('freelist_count', { simple: true })).toBe(0);
    expect(statSync(path).size).toBeLessThan(before);
    expect(statSync(`${path}-wal`).size).toBe(0);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    reader.close();
    db.close();
    await directory.remove();
  }
});

/** 非空间不足的数据库错误仍必须向上抛出，不能伪装成延期优化。 */
it('propagates unrecoverable VACUUM errors', async () => {
  const directory = await temporaryDirectory();
  const db = oldDatabase(join(directory.path, 'old.sqlite'));
  try {
    const original = db.exec.bind(db);
    const failure = Object.assign(new Error('fixture I/O failure'), {
      code: 'SQLITE_IOERR',
    });
    const exec = vi.spyOn(db, 'exec').mockImplementation((statement) => {
      if (statement === 'VACUUM') throw failure;
      return original(statement);
    });
    expect(() => compactDatabase(db)).toThrow(failure);
    exec.mockRestore();
  } finally {
    db.close();
    await directory.remove();
  }
});

/** 后置checkpoint被读者阻塞不撤销已成功的模式转换，之后不再完整VACUUM。 */
it('keeps INCREMENTAL after a blocked post-VACUUM checkpoint', async () => {
  const directory = await temporaryDirectory();
  const path = join(directory.path, 'old.sqlite');
  const db = oldDatabase(path);
  const reader = new Database(path);
  try {
    // 保留VACUUM提交的WAL帧，明确制造后置checkpoint遇到长读者的窗口。
    db.pragma('wal_autocheckpoint=0');
    const original = db.exec.bind(db);
    const exec = vi.spyOn(db, 'exec').mockImplementation((statement) => {
      const result = original(statement);
      if (statement === 'VACUUM') {
        reader.exec('BEGIN');
        reader.prepare('SELECT count(*) FROM payload').get();
      }
      return result;
    });
    compactDatabase(db);
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(2);
    expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);
    reader.exec('ROLLBACK');
    exec.mockClear();
    compactDatabase(db);
    expect(exec).not.toHaveBeenCalledWith('VACUUM');
    expect(statSync(`${path}-wal`).size).toBe(0);
    exec.mockRestore();
  } finally {
    reader.close();
    db.close();
    await directory.remove();
  }
});

/** 关闭可在页批次之间中断，下一轮无需账本即可回收剩余页。 */
it('interrupts incremental reclamation between steps and continues next cycle', async () => {
  const directory = await temporaryDirectory();
  const db = oldDatabase(join(directory.path, 'old.sqlite'));
  try {
    compactDatabase(db);
    db.exec('DELETE FROM payload');
    const before = Number(db.pragma('freelist_count', { simple: true }));
    const stop = new AbortController();
    setImmediate(() => stop.abort());
    await expect(reclaimHistory(db, stop.signal)).rejects.toBeDefined();
    const remaining = Number(db.pragma('freelist_count', { simple: true }));
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(before);
    await reclaimHistory(db, new AbortController().signal);
    expect(db.pragma('freelist_count', { simple: true })).toBe(0);
  } finally {
    db.close();
    await directory.remove();
  }
});
