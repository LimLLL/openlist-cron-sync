// 对无责任的过期Run分批物理清理，FK保持开启且Run行最后删除。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AppConfig } from '../configuration/app-config.js';
import { Readiness } from '../coordination/readiness.js';
import { aborted } from '../common/abort.js';
import { errorTraits } from '../common/errors.js';
import { eligibleRun, idList } from './history-closure.js';

/** 单批子记录上限，与Run候选页大小无关。 */
const CHILD_BATCH = 256;
/** SQLite纯历史清理，不调用任何远程接口。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class HistoryRetention {
  private readonly logger = new Logger(HistoryRetention.name);
  /** 保存进程配置及数据库。
   * @param database 单写连接。
   * @param config 当前保留期。
   * @param readiness 关机闸门。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(Readiness) private readonly readiness: Readiness,
  ) {}
  /** 执行固定cutoff的每日清理，崩溃留下的部分历史下次自然接续。
   * @param now 本轮UTC毫秒，默认当前时间。
   * @returns 本轮结束。
   * @throws Error 非FK的SQL错误；关机停止不改写结果。
   */
  async cycle(now = Date.now()): Promise<void> {
    const db = this.database.db;
    const cutoff = now - this.config.runRetentionDays * 86400000;
    let ended = -1;
    let after = '';
    const signal = this.readiness.shutdown.signal;
    try {
      for (;;) {
        signal.throwIfAborted();
        const rows = db.all<{
          id: string;
          ended: number;
        }>(sql`SELECT id,ended_at AS ended FROM runs WHERE ended_at < ${cutoff}
          AND (ended_at>${ended} OR (ended_at=${ended} AND id>${after})) ORDER BY ended_at,id LIMIT 100`);
        if (!rows.length) break;
        for (const row of rows) {
          ended = row.ended;
          after = row.id;
          if (!eligibleRun(db, row.id, cutoff)) continue;
          try {
            await this.remove(row.id, signal);
          } catch (error) {
            if (!foreignKeyRestriction(error)) throw error;
            this.logger.warn('History run retained after FK restriction', {
              runId: row.id,
              ...errorTraits(error),
            });
          }
        }
      }
      await this.database.reclaimHistory(signal);
    } catch (error) {
      if (!aborted(error, signal)) throw error;
    }
  }
  /** 按外键依赖顺序删除子记录，清除引用和删除行在同批事务完成。
   * @param id 已确认资格的Run。
   * @param signal 关机停止。
   * @returns 本Run物理清理结束。
   * @throws Error SQL失败或停止。
   */
  private async remove(id: string, signal: AbortSignal): Promise<void> {
    const db = this.database.db;
    for (;;) {
      signal.throwIfAborted();
      const rows = db.all<{
        id: string;
      }>(
        sql`SELECT id FROM operations WHERE run_id=${id} LIMIT ${CHILD_BATCH}`,
      );
      if (!rows.length) break;
      const ids = rows.map(recordId);
      // 删除边数量同样分批，避免单个目录顶点带大量下游造成长事务。
      for (;;) {
        const edges = db.all<{ operationId: string; dependsOnId: string }>(
          sql`SELECT operation_id AS operationId,depends_on_id AS dependsOnId FROM operation_dependencies WHERE operation_id IN (${idList(ids)}) OR depends_on_id IN (${idList(ids)}) LIMIT ${CHILD_BATCH}`,
        );
        if (!edges.length) break;
        db.run(
          sql`DELETE FROM operation_dependencies WHERE (operation_id,depends_on_id) IN (${sql.join(
            edges.map(
              /** 按复合主键绑定一条依赖边。
               * @param edge 依赖边。
               * @returns SQL行值。
               * @throws 不适用。
               */
              (edge) => sql`(${edge.operationId},${edge.dependsOnId})`,
            ),
            sql`, `,
          )})`,
        );
        await yieldLoop(undefined, { signal });
      }
      db.transaction(
        /** 单批只删除已经无依赖的操作。
         * @param 不适用。
         * @returns 不适用。
         * @throws Error FK或数据库失败。
         */
        () => {
          // 每个操作的尝试数受冻结重试预算限制；父子同批删除，避免公开列表看到无尝试父行。
          db.run(
            sql`DELETE FROM operation_attempts WHERE operation_id IN (${idList(ids)})`,
          );
          db.run(sql`DELETE FROM operations WHERE id IN (${idList(ids)})`);
        },
      );
      await yieldLoop(undefined, { signal });
    }

    for (;;) {
      signal.throwIfAborted();
      const rows = db.all<{ rowid: number }>(
        sql`SELECT rowid FROM run_retry_items WHERE run_id=${id} LIMIT ${CHILD_BATCH}`,
      );
      if (!rows.length) break;
      db.run(
        sql`DELETE FROM run_retry_items WHERE rowid IN (${sql.join(rows.map(rowId), sql`, `)})`,
      );
      await yieldLoop(undefined, { signal });
    }

    for (const table of ['scan_issues', 'run_targets'] as const)
      for (;;) {
        signal.throwIfAborted();
        const rows = db.all<{ id: string }>(
          sql`SELECT id FROM ${sql.identifier(table)} WHERE run_id=${id} LIMIT ${CHILD_BATCH}`,
        );
        if (!rows.length) break;
        db.run(
          sql`DELETE FROM ${sql.identifier(table)} WHERE id IN (${idList(rows.map(recordId))})`,
        );
        await yieldLoop(undefined, { signal });
      }

    signal.throwIfAborted();
    db.run(sql`DELETE FROM runs WHERE id=${id}`);
    await yieldLoop(undefined, { signal });
  }
}
/** 提取查询ID用于绑定。
 * @param row 查询行。
 * @returns 主键。
 * @throws 不适用。
 */
function recordId(row: { id: string }): string {
  return row.id;
}
/** 绑定无业务主键表的rowid。
 * @param row 查询行。
 * @returns SQL参数。
 * @throws 不适用。
 */
function rowId(row: { rowid: number }) {
  return sql`${row.rowid}`;
}

/** 区分普通SQL错误与SQLite通过内部trigger实现的RESTRICT。
 * @param error Drizzle可能包装的本地异常。
 * @returns 是否明确的外键约束拒绝；不接受任意TRIGGER错误。
 * @throws 不适用。
 */
function foreignKeyRestriction(error: unknown): boolean {
  let cause = error;
  for (let depth = 0; depth < 3 && cause instanceof Error; depth++) {
    if (
      'code' in cause &&
      (cause.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
        (cause.code === 'SQLITE_CONSTRAINT_TRIGGER' &&
          cause.message === 'FOREIGN KEY constraint failed'))
    )
      return true;
    cause = cause.cause;
  }
  return false;
}
