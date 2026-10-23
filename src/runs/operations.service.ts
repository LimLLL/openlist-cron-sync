// 提供操作分页和原子隔离管理；不执行远端重试或文件变更。
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, not, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { operations } from '../database/operation-schema.js';
import { runTargets } from '../database/run-schema.js';
import { PathOccupancy } from '../coordination/path-occupancy.js';
import { ApiError } from '../common/errors.js';
import type { OperationsQueryDto } from './operations.dto.js';
import { operationViews } from './views.js';

/** 操作管理服务。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class OperationsService {
  /** 保存数据库及全局占用判断。
   * @param database 当前数据库。
   * @param paths 活动运行路径。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PathOccupancy) private readonly paths: PathOccupancy,
  ) {}
  /** 读取单条操作，历史状态不因resolution改变。
   * @param id 操作UUID。
   * @returns 数据库记录。
   * @throws ApiError 未找到；Error 数据库失败。
   */
  record(id: string) {
    const row = this.database.db
      .select()
      .from(operations)
      .where(eq(operations.id, id))
      .get();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Operation not found');
    return row;
  }
  /** 显式投影公开字段。
   * @param id 操作UUID。
   * @returns OperationView。
   * @throws ApiError 未找到；Error 数据库失败。
   */
  get(id: string) {
    return operationViews(this.database.db, [this.record(id)])[0];
  }
  /** 按(runId,seq)分页，不加载全部未决历史。
   * @param query 已验证过滤参数。
   * @returns Page OperationView。
   * @throws ApiError 分页溢出；Error 数据库失败。
   */
  list(query: OperationsQueryDto) {
    const offset = (query.page - 1) * query.pageSize;
    if (!Number.isSafeInteger(offset))
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Pagination offset too large',
      );
    // 括号必需：drizzle的not()不会为条件加括号。
    const unresolved = sql`(${operations.status} = 'unknown' AND ${operations.resolutionKind} IS NULL)`;
    const where = and(
      query.status === undefined
        ? undefined
        : eq(operations.status, query.status),
      query.instanceId === undefined
        ? undefined
        : or(
            eq(operations.targetInstanceId, query.instanceId),
            eq(operations.sourceInstanceId, query.instanceId),
          ),
      query.unresolved === undefined
        ? undefined
        : query.unresolved
          ? unresolved
          : not(unresolved),
    );
    const db = this.database.db;
    return {
      items: operationViews(
        db,
        db
          .select()
          .from(operations)
          .where(where)
          .orderBy(asc(operations.runId), asc(operations.seq))
          .limit(query.pageSize)
          .offset(offset)
          .all(),
      ),
      page: query.page,
      pageSize: query.pageSize,
      total:
        db.select({ n: count() }).from(operations).where(where).get()?.n ?? 0,
    };
  }
  /** 幂等提前释放，不重置unknown期限也不解决记录。
   * @param id unknown ID。
   * @param reason 已验证管理员原因。
   * @returns 当前OperationView。
   * @throws ApiError 非未解决unknown；Error 数据库失败。
   */
  release(id: string, reason: string) {
    return this.database.db.transaction(
      /** 事务内检查未知状态并幂等保存首次隔离释放。
       * @param 不适用。
       * @returns 当前公开操作视图。
       * @throws ApiError 状态非法；Error 数据库失败。
       */
      () => {
        const row = this.record(id);
        if (row.status !== 'unknown' || row.resolutionKind !== null)
          throw new ApiError(
            409,
            'INVALID_STATE',
            'Only unresolved unknown can be released',
          );
        if (row.quarantineReleasedAt === null)
          this.database.db
            .update(operations)
            .set({
              quarantineReleasedAt: Date.now(),
              quarantineReleaseReason: reason,
              updatedAt: Date.now(),
            })
            .where(eq(operations.id, id))
            .run();
        return this.get(id);
      },
    );
  }
  /** 结束unknown责任，重复abandon不覆盖原原因。
   * @param id unknown ID。
   * @param reason 已验证管理员原因。
   * @returns 当前OperationView。
   * @throws ApiError 状态不允许或路径被活动Run占用；Error 数据库失败。
   */
  abandon(id: string, reason: string) {
    return this.database.db.transaction(
      /** 事务内校验路径空闲并记录独立abandoned事实。
       * @param 不适用。
       * @returns 保留原始原因的公开操作视图。
       * @throws ApiError 状态非法或PATH_BUSY；Error 数据库失败。
       */
      () => {
        const row = this.record(id);
        if (row.status === 'unknown' && row.resolutionKind === 'abandoned')
          return operationViews(this.database.db, [row])[0];
        if (row.status !== 'unknown' || row.resolutionKind !== null)
          throw new ApiError(
            409,
            'INVALID_STATE',
            'Only unresolved unknown can be abandoned',
          );
        const target = this.database.db
          .select()
          .from(runTargets)
          .where(eq(runTargets.id, row.runTargetId))
          .get();
        if (!target) throw new Error('Operation target missing');
        if (
          this.paths.busy({
            instance: target.config.instance,
            path: row.targetPath,
            write: true,
          })
        )
          throw new ApiError(
            409,
            'PATH_BUSY',
            'An active run occupies this path',
          );
        const now = Date.now();
        this.database.db
          .update(operations)
          .set({
            resolutionKind: 'abandoned',
            resolutionNote: reason,
            resolvedAt: now,
            quarantineReleasedAt: row.quarantineReleasedAt ?? now,
            quarantineReleaseReason: row.quarantineReleaseReason ?? reason,
            updatedAt: now,
          })
          .where(eq(operations.id, id))
          .run();
        return this.get(id);
      },
    );
  }
}
