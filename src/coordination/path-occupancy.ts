// 按快照身份维护运行路径占用；不建立第二套持久化锁。
import { Injectable } from '@nestjs/common';
import type { RunRecord } from '../database/run-schema.js';
import type { InstanceSnapshot } from '../runs/run-types.js';
import { containsPath, globalPath } from '../openlist/paths.js';

/** 单个端点的只读或写入占用。 */
export interface PathClaim {
  /** 固定实例身份。 */
  instance: InstanceSnapshot;
  /** 账号路径。 */
  path: string;
  /** 是否会修改目标文件。 */
  write: boolean;
}
/** 比较两个快照端点，别名账号按全局路径比较。
 * @param a 左端点。
 * @param b 右端点。
 * @returns 相等或祖先后代是否重叠。
 * @throws ApiError 快照路径非法。
 */
export function overlaps(a: PathClaim, b: PathClaim): boolean {
  if (a.instance.baseUrl === b.instance.baseUrl) {
    const ap = globalPath(a.instance.accountBasePath, a.path);
    const bp = globalPath(b.instance.accountBasePath, b.path);
    return containsPath(ap, bp) || containsPath(bp, ap);
  }
  return (
    a.instance.id === b.instance.id &&
    (containsPath(a.path, b.path) || containsPath(b.path, a.path))
  );
}
/** 统一服务派发、恢复和管理员解决操作的路径占用。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class PathOccupancy {
  private readonly claims = new Map<string, PathClaim[]>();
  /** 从运行快照构造完整端点集合。
   * @param run 待派发或恢复的运行。
   * @returns 当前运行应占用的路径。
   * @throws Error 快照身份缺失。
   */
  forRun(run: RunRecord): PathClaim[] {
    return [run.config.job.source, ...run.config.job.targets].map(
      /** 把固定端点转换为预览只读或真实目标写入占用。
       * @param endpoint 固定端点配置。
       * @param index 端点或块的序号。
       * @returns 单个端点占用。
       * @throws Error 快照缺少实例身份。
       */
      (endpoint, index) => {
        const instance = run.config.instances[endpoint.instanceId];
        if (!instance) throw new Error('Run identity missing');
        return {
          instance,
          path: endpoint.path,
          write: index > 0 && !run.dryRun,
        };
      },
    );
  }
  /** 同步尝试一次取得全部路径；失败时不留下部分占用。
   * @param run 待派发运行。
   * @returns 是否取得占用。
   * @throws Error 快照非法。
   */
  acquire(run: RunRecord): boolean {
    const next = this.forRun(run);
    for (const [id, held] of this.claims) {
      if (id === run.id) continue;
      if (
        next.some(
          /** 检查候选端点是否与已持有的读写范围冲突。
           * @param a 左侧比较值。
           * @returns 是否存在冲突。
           * @throws ApiError 快照路径非法。
           */
          (a) =>
            held.some(
              /** 仅在至少一方写入且路径相交时判定冲突。
               * @param b 右侧比较值。
               * @returns 是否互斥。
               * @throws ApiError 快照路径非法。
               */
              (b) => (a.write || b.write) && overlaps(a, b),
            ),
        )
      )
        return false;
    }
    this.claims.set(run.id, next);
    return true;
  }
  /** 恢复旧责任，不依赖新执行位是否可用。
   * @param run 尚未收尾的旧运行。
   * @returns 不适用。
   * @throws Error 快照非法。
   */
  restore(run: RunRecord): void {
    this.claims.set(run.id, this.forRun(run));
  }
  /** 检查管理员操作是否与任何活动读取或写入重叠。
   * @param claim 被管理的未知操作路径。
   * @returns 是否有活动运行占用。
   * @throws ApiError 快照路径非法。
   */
  busy(claim: PathClaim): boolean {
    for (const held of this.claims.values())
      if (
        held.some(
          /** 检查管理员管理路径是否与活动占用相交。
           * @param item 当前待检查值。
           * @returns 是否被占用。
           * @throws ApiError 快照路径非法。
           */
          (item) => overlaps(item, claim),
        )
      )
        return true;
    return false;
  }
  /** 仅在终态已持久化或进程停止时释放。
   * @param runId 运行ID。
   * @returns 不适用。
   * @throws 不适用。
   */
  release(runId: string): void {
    this.claims.delete(runId);
  }
}
