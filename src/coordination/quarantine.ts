// 分页读取未知责任；身份比较用旧快照，刷新许可从不永久缓存。
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull, or, inArray, gte, lt } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { operations } from '../database/operation-schema.js';
import type { OperationRecord } from '../database/operation-schema.js';
import { instances } from '../database/schema.js';
import { runTargets } from '../database/run-schema.js';
import type { InstanceSnapshot } from '../runs/run-types.js';
import { containsPath, globalPath } from '../openlist/paths.js';

/** 一条操作及其固定目标身份。 */
export interface QuarantineFact {
  /** 不改写的历史unknown。 */
  operation: OperationRecord;
  /** 原Run保存的实例身份。 */
  instance: InstanceSnapshot;
  /** 转换到调用方账号空间的路径；null表示调用方不能观察祖先。 */
  localPath: string | null;
}
/** 只负责隔离匹配和事实存取，不执行网络观察。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class Quarantine {
  /** 保存数据库叶子依赖。
   * @param database 权威操作记录。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  /** 查询与候选动作重叠的未知责任，内存最多一页。
   * @param instance 本Run实例快照。
   * @param path 候选账号路径。
   * @param action 删除还需检查后代责任。
   * @returns 按ID分页的相关事实。
   * @throws Error 数据库或快照损坏。
   */
  *matching(
    instance: InstanceSnapshot,
    path: string,
    action: 'mkdir' | 'create' | 'delete' = 'delete',
  ): Generator<QuarantineFact> {
    const currentGlobal = globalPath(instance.accountBasePath, path);
    for (const scope of this.scopes(instance, path, action)) {
      let afterPath = '';
      let afterId = '';
      const ancestors: string[] = [];
      if (scope.path !== null) {
        let parent = scope.path;
        while (parent !== '/') {
          parent = parent.slice(0, parent.lastIndexOf('/')) || '/';
          ancestors.push(parent);
        }
      }
      for (;;) {
        const range =
          scope.path === null || scope.path === '/'
            ? undefined
            : or(
                eq(operations.targetPath, scope.path),
                and(
                  eq(operations.isDir, true),
                  inArray(operations.targetPath, ancestors),
                ),
                action === 'delete'
                  ? and(
                      gte(operations.targetPath, scope.path + '/'),
                      lt(operations.targetPath, scope.path + '0'),
                    )
                  : undefined,
              );
        const page = this.database.db
          .select({ operation: operations, config: runTargets.config })
          .from(operations)
          .innerJoin(runTargets, eq(runTargets.id, operations.runTargetId))
          .where(
            and(
              eq(operations.targetInstanceId, scope.id),
              eq(operations.status, 'unknown'),
              isNull(operations.resolutionKind),
              range,
              afterId
                ? or(
                    gt(operations.targetPath, afterPath),
                    and(
                      eq(operations.targetPath, afterPath),
                      gt(operations.id, afterId),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(operations.targetPath), asc(operations.id))
          .limit(128)
          .all();
        if (!page.length) break;
        for (const row of page) {
          afterPath = row.operation.targetPath;
          afterId = row.operation.id;
          const old = row.config.instance;
          const sameBase = old.baseUrl === instance.baseUrl;
          const oldPath = sameBase
            ? globalPath(old.accountBasePath, row.operation.targetPath)
            : row.operation.targetPath;
          const nextPath = sameBase ? currentGlobal : path;
          if (
            oldPath !== nextPath &&
            !(row.operation.isDir && containsPath(oldPath, nextPath)) &&
            !(action === 'delete' && containsPath(nextPath, oldPath))
          )
            continue;
          const localPath = sameBase
            ? containsPath(instance.accountBasePath, oldPath)
              ? '/' +
                oldPath.slice(
                  instance.accountBasePath === '/'
                    ? 1
                    : instance.accountBasePath.length + 1,
                )
              : null
            : row.operation.targetPath;
          yield {
            operation: row.operation,
            instance: old,
            localPath: oldPath === instance.accountBasePath ? '/' : localPath,
          };
        }
      }
    }
  }
  /** 先按当前实例缩小索引范围；未决责任禁止修改身份，最终比较仍核对原Run快照。
   * @param instance 当前Run的固定身份。
   * @param path 候选账号路径。
   * @param action 是否允许查询后代责任。
   * @returns 分页实例范围；path=null表示该账号整个子树被候选删除覆盖。
   * @throws Error 数据库失败或身份路径非法。
   */
  private *scopes(
    instance: InstanceSnapshot,
    path: string,
    action: string,
  ): Generator<{
    /** 被保护实例ID。 */ id: string;
    /** 查询账号路径；null为整个账号。 */ path: string | null;
  }> {
    let after = '';
    const global = globalPath(instance.accountBasePath, path);
    for (;;) {
      const page = this.database.db
        .select({
          id: instances.id,
          baseUrl: instances.baseUrl,
          basePath: instances.accountBasePath,
        })
        .from(instances)
        .where(
          and(
            gt(instances.id, after),
            or(
              eq(instances.id, instance.id),
              eq(instances.baseUrl, instance.baseUrl),
            ),
          ),
        )
        .orderBy(asc(instances.id))
        .limit(128)
        .all();
      if (!page.length) return;
      for (const candidate of page) {
        after = candidate.id;
        if (candidate.baseUrl !== instance.baseUrl) {
          yield { id: candidate.id, path };
          continue;
        }
        if (candidate.basePath === null) continue;
        if (containsPath(candidate.basePath, global)) {
          const local =
            global === candidate.basePath
              ? '/'
              : '/' +
                global.slice(
                  candidate.basePath === '/'
                    ? 1
                    : candidate.basePath.length + 1,
                );
          yield { id: candidate.id, path: local };
        } else if (
          action === 'delete' &&
          containsPath(global, candidate.basePath)
        )
          yield { id: candidate.id, path: null };
      }
    }
  }
  /** 判断未释放且未过期的隔离，不依赖历史reobserved_at。
   * @param operation 未解决unknown。
   * @returns 是否仍active。
   * @throws 不适用。
   */
  active(operation: OperationRecord): boolean {
    return (
      operation.resolutionKind === null &&
      operation.quarantineReleasedAt === null &&
      Date.now() < (operation.unknownUntil ?? Infinity)
    );
  }
  /** 原子记录首次成功重新观察。
   * @param id unknown ID。
   * @param runId 实际执行观察的新Run。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  reobserved(id: string, runId: string): void {
    const now = Date.now();
    this.database.db
      .update(operations)
      .set({ reobservedAt: now, reobservedByRunId: runId, updatedAt: now })
      .where(
        and(
          eq(operations.id, id),
          isNull(operations.reobservedAt),
          isNull(operations.resolutionKind),
        ),
      )
      .run();
  }
  /** 写入独立解决事实，永远不改unknown结果。
   * @param id 原操作ID。
   * @param runId 完成观察或新动作的Run。
   * @param kind 自动解决方式。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  resolve(id: string, runId: string, kind: 'observed' | 'superseded'): void {
    const now = Date.now();
    this.database.db
      .update(operations)
      .set({
        resolutionKind: kind,
        resolvedAt: now,
        resolvedByRunId: runId,
        updatedAt: now,
      })
      .where(
        and(
          eq(operations.id, id),
          eq(operations.status, 'unknown'),
          isNull(operations.resolutionKind),
        ),
      )
      .run();
  }
}
