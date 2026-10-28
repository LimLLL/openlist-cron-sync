// 按有界索引页扩展Run引用闭包，避免每晚物化全部历史关系。
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/** SQL查询的单个Run ID。 */
interface RunId {
  /** Run主键。 */ id: string;
}
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
    AND NOT EXISTS (SELECT 1 FROM operations o WHERE o.run_id=r.id AND o.remote_cleanup_pending=1)`) !==
    undefined
  );
}
/** 收集一组双向引用；有任何不合格成员则不删除。
 * @param db 单写连接。
 * @param seed 超期Run候选。
 * @param cutoff 本轮截止时刻。
 * @param signal 停止信号。
 * @returns 闭包成员及是否全部可清理。
 * @throws Error SQL失败或关机。
 */
export async function historyClosure(
  db: BetterSQLite3Database,
  seed: string,
  cutoff: number,
  signal: AbortSignal,
) {
  const members = new Set([seed]);
  const queue = [seed];
  for (let index = 0; index < queue.length; index++) {
    signal.throwIfAborted();
    const id = queue[index];
    if (!eligibleRun(db, id, cutoff)) return { members, eligible: false };
    /** 吸收邻接Run，双向关系只遍历一次。
     * @param rows 邻接查询结果。
     * @returns 不适用。
     * @throws 不适用。
     */
    const add = (rows: RunId[]): void => {
      for (const row of rows)
        if (!members.has(row.id)) {
          members.add(row.id);
          queue.push(row.id);
        }
    };
    // 显式分页操作ID，使跨Run异常引用也不能绕过闭包；每页反向FK查询命中各引用索引。
    let afterSeq = 0;
    for (;;) {
      const rows = db.all<{
        id: string;
        seq: number;
        retry: string | null;
      }>(sql`
        SELECT id,seq,retry_of AS retry
        FROM operations WHERE run_id=${id} AND seq>${afterSeq} ORDER BY seq LIMIT 256`);
      if (!rows.length) break;
      const ids: string[] = [];
      const refs: string[] = [];
      for (const row of rows) {
        afterSeq = row.seq;
        ids.push(row.id);
        if (row.retry) refs.push(row.retry);
      }
      if (refs.length)
        add(
          db.all<RunId>(
            sql`SELECT DISTINCT run_id AS id FROM operations WHERE id IN (${idList(refs)}) AND run_id != ${id}`,
          ),
        );
      add(
        db.all<RunId>(
          sql`SELECT DISTINCT run_id AS id FROM operations WHERE retry_of IN (${idList(ids)}) AND run_id != ${id}`,
        ),
      );
      await yieldLoop(undefined, { signal });
    }
  }
  return { members, eligible: true };
}
