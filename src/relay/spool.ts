// 保存当前进程拥有的私有块；按完整chunk预留空间保证frontier可推进。
import { Inject, Injectable } from '@nestjs/common';
import {
  mkdir,
  readdir,
  rename,
  rm,
  statfs,
  writeFile,
  readFile,
} from 'node:fs/promises';
import { join, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AppConfig } from '../configuration/app-config.js';
import { RelayError } from './errors.js';

export const BLOCK_BYTES = 1024 * 1024;
/** 已发布的spool块。 */
export interface Block {
  /** 仅本服务生成的本地文件路径。 */
  path: string;
  /** payload字节数。 */
  size: number;
}
/** 一次chunk空间预留，写入时从承诺额度转为实际占用。 */
export interface Reservation {
  /** 尚未实际写入的字节数。 */
  remaining: number;
}
/** 当前进程的spool分配器；数据库不保存块索引。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class Spool {
  private committed = 0;
  private held = 0;
  private generation = 0;
  /** frontier按FIFO排在预读前，避免小额预读不断抢走大chunk需要的空间。 */
  private readonly waiting: {
    /** 是否为已持久化session的frontier。 */ strict: boolean;
  }[] = [];
  /** 固定spool位置与SQLite保留量。
   * @param config 进程配置。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(@Inject(AppConfig) private readonly config: AppConfig) {}
  /** 责任重建后删除仅属于本服务的块目录，不清空用户指定目录。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 清理范围与DATA_DIR重叠，或文件系统读取/清理失败。
   */
  async reset(): Promise<void> {
    for (const name of await readdir(this.config.spoolDir))
      if (/^relay-[0-9a-f-]{36}$/.test(name)) {
        const directory = join(this.config.spoolDir, name);
        if (
          this.config.dataDir === directory ||
          this.config.dataDir.startsWith(directory + sep)
        )
          throw new Error('Spool cleanup overlaps DATA_DIR');
        await rm(directory, {
          recursive: true,
          force: true,
        });
      }
    this.held = 0;
    this.committed = 0;
    this.generation++;
  }
  /** 查询当前文件系统可用字节，不把已写入payload重复扣除。
   * @param 不适用。
   * @returns 可用于spool的新空间。
   * @throws Error statfs失败。
   */
  async available(): Promise<number> {
    const fs = await statfs(this.config.spoolDir, { bigint: true });
    const bytes = fs.bavail * fs.bsize - BigInt(this.config.spoolReserveBytes);
    return Number(
      bytes > BigInt(Number.MAX_SAFE_INTEGER)
        ? BigInt(Number.MAX_SAFE_INTEGER)
        : bytes,
    );
  }
  /** 为一个完整frontier预留可推进的额度；等待期间不持有零碎预留。
   * @param bytes 还需要写入的payload。
   * @param totalPayload 本文件此chunk的完整payload，含已准备首块。
   * @param signal 等待停止信号。
   * @param strict session落库后才能启用不足容量的主动失败。
   * @returns 空间预留。
   * @throws RelayError 当前独占容量不足；Error 等待取消或statfs失败。
   */
  async reserve(
    bytes: number,
    totalPayload: number,
    signal: AbortSignal,
    strict: boolean,
  ): Promise<Reservation> {
    if (bytes === 0) return { remaining: 0 };
    const waiter = { strict };
    const prefetch = this.waiting.findIndex(
      /** 找到首个预读者，frontier只能插在它之前，不能超过已有frontier。
       * @param entry 已排队空间请求。
       * @returns 是否为尚未init的预读。
       * @throws 不适用。
       */
      (entry) => !entry.strict,
    );
    if (strict && prefetch >= 0) this.waiting.splice(prefetch, 0, waiter);
    else this.waiting.push(waiter);
    this.generation++;
    try {
      for (;;) {
        signal.throwIfAborted();
        const generation = this.generation;
        const available = await this.available();
        if (generation !== this.generation) continue;
        if (
          strict &&
          this.committed === 0 &&
          available + this.held < totalPayload
        )
          throw new RelayError('SPOOL_FULL', 'insufficient spool capacity');
        if (this.waiting[0] === waiter && available - this.committed >= bytes) {
          this.committed += bytes;
          this.generation++;
          return { remaining: bytes };
        }
        await delay(25, undefined, { signal });
      }
    } finally {
      this.waiting.splice(this.waiting.indexOf(waiter), 1);
      this.generation++;
    }
  }
  /** 将完整块先写临时文件再原子发布。
   * @param attemptId 当前尝试ID。
   * @param index 文件内块号。
   * @param data 完整payload。
   * @param reservation 已取得空间。
   * @returns 已发布块。
   * @throws RelayError 文件系统写入失败。
   */
  async publish(
    attemptId: string,
    index: number,
    data: Buffer,
    reservation: Reservation,
  ): Promise<Block> {
    const directory = join(this.config.spoolDir, `relay-${attemptId}`);
    const path = join(directory, String(index));
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path + '.tmp', data, { mode: 0o600 });
      await rename(path + '.tmp', path);
      reservation.remaining -= data.length;
      this.committed -= data.length;
      this.held += data.length;
      this.generation++;
      return { path, size: data.length };
    } catch (error) {
      throw spoolError(error);
    }
  }
  /** 读取已发布的原始块用于首次上传及同session重传。
   * @param block 已发布块。
   * @returns 完整原始字节。
   * @throws RelayError 读取失败。
   */
  async read(block: Block): Promise<Buffer> {
    try {
      return await readFile(block.path);
    } catch (error) {
      throw spoolError(error);
    }
  }
  /** 释放已确认或已收尾的数据。
   * @param blocks 不再有读取者的块。
   * @returns 删除完成。
   * @throws RelayError 清理失败，不能谎称已释放空间。
   */
  async release(blocks: readonly Block[]): Promise<void> {
    for (const block of blocks) {
      try {
        await rm(block.path, { force: true });
      } catch (error) {
        throw spoolError(error);
      }
      this.held -= block.size;
      this.generation++;
    }
  }
  /** 归还未使用的承诺额度。
   * @param reservation 当前预留。
   * @returns 不适用。
   * @throws 不适用。
   */
  unreserve(reservation: Reservation): void {
    this.committed -= reservation.remaining;
    reservation.remaining = 0;
    this.generation++;
  }
  /** 文件所有读取者退出后移除空目录或失败临时块。
   * @param attemptId 本服务创建的UUID。
   * @returns 清理完成。
   * @throws RelayError 文件系统清理失败。
   */
  async finish(attemptId: string): Promise<void> {
    try {
      await rm(join(this.config.spoolDir, `relay-${attemptId}`), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      throw spoolError(error);
    }
  }
}
/** 把OS错误转换为不泄漏本地路径的原因。
 * @param error 文件系统错误。
 * @returns relay失败。
 * @throws 不适用。
 */
function spoolError(error: unknown): RelayError {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined;
  return new RelayError(
    code === 'ENOSPC' || code === 'EDQUOT' ? 'SPOOL_FULL' : 'SPOOL_IO_ERROR',
    code === 'ENOSPC' || code === 'EDQUOT'
      ? 'spool write ENOSPC/EDQUOT'
      : 'spool I/O failed',
  );
}
