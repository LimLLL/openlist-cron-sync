// 验证启动清理只处理spool命名空间，错误配置也不能删除数据库。
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../src/configuration/app-config.js';
import { Spool } from '../src/relay/spool.js';
import { environmentFor, temporaryDirectory } from './helpers.js';

/** 数据目录误放进旧块命名空间时必须拒绝清理。
 * @param 不适用。
 * @returns 文件保护验证完成。
 * @throws Error 断言或临时目录清理失败。
 */
it('refuses to remove DATA_DIR while rebuilding spool responsibility', async () => {
  const temporary = await temporaryDirectory();
  try {
    const dataDir = join(
      temporary.path,
      'relay-00000000-0000-0000-0000-000000000000',
    );
    const config = new AppConfig(
      new ConfigService({
        environment: environmentFor(dataDir, { SPOOL_DIR: temporary.path }),
      }),
    );
    await config.onModuleInit();
    const database = join(config.dataDir, 'app.db');
    await writeFile(database, 'database must survive');
    await expect(new Spool(config).reset()).rejects.toThrow(
      'overlaps DATA_DIR',
    );
    expect(await readFile(database, 'utf8')).toBe('database must survive');
  } finally {
    await temporary.remove();
  }
});

/** 无责任的旧块可以删除，但用户目录中的其它内容必须保留。
 * @param 不适用。
 * @returns 命名空间验证完成。
 * @throws Error 断言或文件系统失败。
 */
it('cleans only private relay directories after responsibility rebuild', async () => {
  const temporary = await temporaryDirectory();
  try {
    const config = new AppConfig(
      new ConfigService({ environment: environmentFor(temporary.path) }),
    );
    await config.onModuleInit();
    await mkdir(
      join(config.spoolDir, 'relay-00000000-0000-0000-0000-000000000000'),
    );
    await writeFile(join(config.spoolDir, 'unrelated'), 'keep');
    await new Spool(config).reset();
    expect(await readdir(config.spoolDir)).toEqual(['unrelated']);
  } finally {
    await temporary.remove();
  }
});

/** 大frontier等待空间时，小额预读不能持续抢占刚释放的碎片。
 * @param 不适用。
 * @returns frontier先获得完整容量，随后预读继续。
 * @throws Error 断言或文件系统失败。
 */
it('prioritizes a whole frontier over a queued smaller prefetch', async () => {
  const temporary = await temporaryDirectory();
  const stop = new AbortController();
  const work: Promise<unknown>[] = [];
  try {
    const config = new AppConfig(
      new ConfigService({ environment: environmentFor(temporary.path) }),
    );
    await config.onModuleInit();
    const spool = new Spool(config);
    let available = 8;
    const observe = vi.spyOn(spool, 'available').mockImplementation(
      /** 提供包含本进程已占用块的有限文件系统余量。
       * @param 不适用。
       * @returns 当前剩余字节数。
       * @throws 不适用。
       */
      async () => available,
    );
    const owned = await spool.reserve(8, 8, stop.signal, false);
    const id = randomUUID();
    const one = await spool.publish(id, 0, Buffer.alloc(1), owned);
    const seven = await spool.publish(id, 1, Buffer.alloc(7), owned);
    spool.unreserve(owned);
    available = 0;
    let prefetched = false;
    const prefetch = spool.reserve(1, 1, stop.signal, false).then(
      /** 记录小额预读何时获准。
       * @param reservation 已获准的预留。
       * @returns 原预留供用例归还。
       * @throws 不适用。
       */
      (reservation) => {
        prefetched = true;
        return reservation;
      },
    );
    const frontier = spool.reserve(8, 8, stop.signal, true);
    work.push(prefetch, frontier);
    await spool.release([one]);
    available = 1;
    const reads = observe.mock.calls.length;
    await vi.waitFor(
      /** 等待两个候选都重新观察有限余量，不能只断言启动瞬间。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 尚未观察，由waitFor重试。
       */
      () => expect(observe.mock.calls.length).toBeGreaterThan(reads + 2),
    );
    expect(prefetched).toBe(false);
    await spool.release([seven]);
    available = 8;
    const allocated = await frontier;
    expect(prefetched).toBe(false);
    spool.unreserve(allocated);
    spool.unreserve(await prefetch);
  } finally {
    stop.abort();
    await Promise.allSettled(work);
    vi.restoreAllMocks();
    await temporary.remove();
  }
});
