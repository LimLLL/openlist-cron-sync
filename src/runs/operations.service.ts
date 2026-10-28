// 提供只读操作历史与分页查询，不执行远端重试或文件变更。
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { operations } from '../database/operation-schema.js';
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
  /** 保存历史查询所需数据库。
   * @param database 当前数据库。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  /** 读取单条操作的历史结果。
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
}
