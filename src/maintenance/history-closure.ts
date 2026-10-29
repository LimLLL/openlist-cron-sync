// 提供历史保留资格与参数化ID列表；重试不再产生跨Run硬引用。
import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/** 参数化小批IN列表。
 * @param ids 经过数据库读取的ID。
 * @returns SQL绑定列表。
 * @throws 不适用。
 */
export function idList(ids: string[]) {
  return sql.join(
    ids.map(
      /** 将ID作为参数而非SQL文本。
       * @param id 主键。
       * @returns 绑定参数。
       * @throws 不适用。
       */
      (id) => sql`${id}`,
    ),
    sql`, `,
  );
}
/** 判断一个Run是否超期、终态且没有待删除的远程任务记录。
 * @param db 数据库。
 * @param id Run ID。
 * @param cutoff 本轮固定截止时刻。
 * @returns 是否符合保留清理资格。
 * @throws Error SQL失败。
 */
export function eligibleRun(
  db: BetterSQLite3Database,
  id: string,
  cutoff: number,
): boolean {
  return (
    db.get(sql`SELECT 1 FROM runs r WHERE r.id=${id} AND r.ended_at < ${cutoff}
    AND r.status IN ('succeeded','partial','failed','cancelled','interrupted')
    AND NOT EXISTS (SELECT 1 FROM operation_attempts a INDEXED BY attempts_cleanup JOIN operations o ON o.id=a.operation_id WHERE a.remote_cleanup_pending=1 AND o.run_id=r.id)`) !==
    undefined
  );
}
