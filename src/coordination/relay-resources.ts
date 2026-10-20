// 集中管理所有Run共享的relay名额与Job带宽桶。
import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../configuration/app-config.js';
import type { InstanceRecord } from '../database/schema.js';
import { BandwidthBucket, Permits } from './permits.js';

/** 一个有引用计数的实例资源池。 */
interface Pool {
  /** 并发信号量。 */
  permits: Permits;
  /** 已取得或正在等待该资源的调用数。 */
  references: number;
}
/** 共享配额所有者，调用方不得创建自己的实例资源池。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class RelayResources {
  readonly downloads: Permits;
  readonly uploads: Permits;
  readonly admission: Permits;
  private readonly pools = new Map<string, Pool>();
  private readonly buckets = new Map<string, BandwidthBucket>();
  /** 初始化进程固定worker上限。
   * @param config 进程资源配置。
   * @returns 不适用。
   * @throws RangeError 配额非法。
   */
  constructor(@Inject(AppConfig) config: AppConfig) {
    this.downloads = new Permits(config.relayDownloadWorkers);
    this.uploads = new Permits(config.relayUploadWorkers);
    this.admission = new Permits(config.relayDownloadWorkers);
  }
  /** 取得一个实例的具体资源，取消等待也会释放引用。
   * @param instance 固定实例配额。
   * @param kind 下载连接、上传session或chunk。
   * @param signal 等待停止信号。
   * @returns 幂等释放函数。
   * @throws Error 等待取消。
   */
  async acquire(
    instance: InstanceRecord,
    kind: 'download' | 'session' | 'chunk',
    signal: AbortSignal,
  ): Promise<() => void> {
    const key = `${instance.id}:${kind}`;
    const capacity =
      kind === 'download'
        ? instance.maxDownloadConnections
        : kind === 'session'
          ? instance.maxUploadSessions
          : instance.maxChunkConcurrency;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = { permits: new Permits(capacity), references: 0 };
      this.pools.set(key, pool);
    }
    pool.references++;
    const current = pool;
    /** 释放空池引用，避免历史实例无限留在内存。
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
  /** 同时预留一条源连接与目标上传会话，按稳定资源键避免反向传输死锁。
   * @param source 源实例。
   * @param target 目标实例。
   * @param signal 准入停止信号。
   * @returns 释放全部资源的函数。
   * @throws Error 取消时撤销所有已取得资源。
   */
  async file(
    source: InstanceRecord,
    target: InstanceRecord,
    signal: AbortSignal,
  ): Promise<() => void> {
    const releases: (() => void)[] = [];
    const needs: [InstanceRecord, 'download' | 'session'][] = [
      [source, 'download'],
      [target, 'session'],
    ];
    needs.sort(
      /** 按实例ID和资源种类排序，固定多资源获取顺序。
       * @param a 左侧比较值。
       * @param b 右侧比较值。
       * @returns 字典序比较值。
       * @throws 不适用。
       */
      (a, b) => `${a[0].id}:${a[1]}`.localeCompare(`${b[0].id}:${b[1]}`),
    );
    try {
      for (const [instance, kind] of needs)
        releases.push(await this.acquire(instance, kind, signal));
    } catch (error) {
      for (const release of releases.reverse()) release();
      throw error;
    }
    /** 文件退出时归还全部已取得名额。
     * @param 不适用。
     * @returns 不适用。
     * @throws 不适用。
     */
    return () => {
      for (const release of releases) release();
    };
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
