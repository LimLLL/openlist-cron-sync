// 集中管理按Job源与Target划分的relay文件名额及Job带宽桶，不设进程级并发上限。
import { Injectable } from '@nestjs/common';
import { BandwidthBucket, Permits } from './permits.js';

/** 一个有引用计数的资源池。 */
interface Pool {
  /** 并发信号量。 */
  permits: Permits;
  /** 已取得或正在等待该资源的调用数。 */
  references: number;
}
/** 共享配额所有者，调用方不得创建自己的资源池。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class RelayResources {
  private readonly pools = new Map<string, Pool>();
  private readonly buckets = new Map<string, BandwidthBucket>();
  /** 取得一个资源池的名额，取消等待也会释放引用。
   * @param key Job源或Target资源键。
   * @param capacity 本Run固定的并发数；0表示不限。
   * @param signal 等待停止信号。
   * @returns 幂等释放函数。
   * @throws Error 等待取消。
   */
  private async acquire(
    key: string,
    capacity: number,
    signal: AbortSignal,
  ): Promise<() => void> {
    if (capacity === 0) {
      signal.throwIfAborted();
      return () => undefined;
    }
    let pool = this.pools.get(key);
    if (!pool) {
      pool = { permits: new Permits(capacity), references: 0 };
      this.pools.set(key, pool);
    }
    pool.references++;
    const current = pool;
    /** 释放空池引用，避免已结束的Job或Target无限留在内存。
     * @param 不适用。
     * @returns 不适用。
     * @throws 不适用。
     */
    const dereference = (): void => {
      if (--current.references === 0) this.pools.delete(key);
    };
    try {
      const release = await current.permits.acquire(signal);
      let done = false;
      /** 同时归还并发位和资源引用，重复调用无副作用。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      return () => {
        if (!done) {
          done = true;
          release();
          dereference();
        }
      };
    } catch (error) {
      dereference();
      throw error;
    }
  }
  /** 预留一个Job源名额与一个Target文件名额，分别在源结束及文件收尾后释放。
   * 所有调用都先取源再取目标，固定获取顺序避免交叉等待死锁。
   * @param jobId Job ID；同Job的全部Target共用源名额。
   * @param targetId 稳定Target ID。
   * @param sourceCapacity Job源下载并发；0表示不限。
   * @param targetCapacity Target文件并发；0表示不限。
   * @param signal 准入停止信号。
   * @returns 两个独立且幂等的释放函数。
   * @throws Error 取消时撤销所有已取得名额。
   */
  async relayFile(
    jobId: string,
    targetId: string,
    sourceCapacity: number,
    targetCapacity: number,
    signal: AbortSignal,
  ): Promise<{ source: () => void; target: () => void }> {
    const source = await this.acquire(
      `job:${jobId}:source`,
      sourceCapacity,
      signal,
    );
    try {
      const target = await this.acquire(
        `target:${targetId}:files`,
        targetCapacity,
        signal,
      );
      return { source, target };
    } catch (error) {
      source();
      throw error;
    }
  }
  /** 取得Job共享上传桶；同Job的所有Target和重传共用。
   * @param jobId Job ID。
   * @param rate 本Run固定bytes/s。
   * @returns 聚合桶。
   * @throws 不适用。
   */
  bucket(jobId: string, rate: number): BandwidthBucket {
    let bucket = this.buckets.get(jobId);
    if (!bucket) {
      bucket = new BandwidthBucket(rate);
      this.buckets.set(jobId, bucket);
    }
    return bucket;
  }
  /** Run完全收尾后释放Job桶；同Job不允许重叠运行。
   * @param jobId Job ID。
   * @returns 不适用。
   * @throws 不适用。
   */
  releaseJob(jobId: string): void {
    this.buckets.delete(jobId);
  }
}
