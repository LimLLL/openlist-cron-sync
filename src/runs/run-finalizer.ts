// 运行终态事务统一收尾未派发动作、统计和路径密码，不改写历史终态。
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { runs, runTargets } from '../database/run-schema.js';
import { operations } from '../database/operation-schema.js';
import { runResult } from '../sync/results.js';
import type { RunStatus } from './run-types.js';

export const TERMINAL_RUNS: RunStatus[] = [
  'succeeded',
  'partial',
  'failed',
  'cancelled',
  'interrupted',
];
/** 原子形成Run最终结果，只有调用者确认本地worker退出后才使用。
 * @param db 单写数据库。
 * @param id 当前Run。
 * @param forced 取消、恢复或本地错误的优先终态；省略按操作聚合。
 * @param stopReason 取消/重启原因。
 * @param errorCode 本地或排队错误。
 * @returns 不适用。
 * @throws Error 数据库失败。
 */
export function finishRun(
  db: BetterSQLite3Database,
  id: string,
  forced?: 'failed' | 'cancelled' | 'interrupted',
  stopReason: string | null = null,
  errorCode: string | null = null,
): void {
  db.transaction(
    /** 在一个事务内收尾操作、聚合目标和Run并清除路径密码。
     * @param 不适用。
     * @returns 不适用。
     * @throws Error 数据库失败。
     */
    () => {
      const run = db.select().from(runs).where(eq(runs.id, id)).get();
      if (!run) throw new Error('Run missing during finalization');
      if (TERMINAL_RUNS.includes(run.status)) return;
      const now = Date.now();
      if (forced) {
        db.update(operations)
          .set({
            status: forced === 'cancelled' ? 'cancelled' : 'skipped',
            errorCode: forced === 'cancelled' ? null : 'PLAN_INTERRUPTED',
            errorMessage: forced === 'cancelled' ? null : 'PLAN_INTERRUPTED',
            endedAt: now,
            updatedAt: now,
          })
          .where(
            and(eq(operations.runId, id), eq(operations.status, 'pending')),
          )
          .run();
        db.update(operations)
          .set({
            status: 'unknown',
            remoteCleanupPending: sql`CASE WHEN openlist_task_id IS NOT NULL THEN 1 ELSE 0 END`,
            errorCode: 'OPENLIST_ERROR',
            errorMessage: 'Stopped without completion evidence',
            endedAt: now,
            updatedAt: now,
            unknownSince: now,
            unknownUntil: now + run.config.settings.quarantineSeconds * 1000,
          })
          .where(
            and(
              eq(operations.runId, id),
              inArray(operations.status, [
                'submitting',
                'submitted',
                'running',
              ]),
            ),
          )
          .run();
      }
      const result = runResult(db, run);
      if (run.dryRun) {
        for (const target of result.targets) {
          target.stats.failedOperations = 0;
          target.stats.unknownOperations = 0;
          target.stats.cancelledOperations = 0;
        }
        result.stats.failedOperations = 0;
        result.stats.unknownOperations = 0;
        result.stats.cancelledOperations = 0;
      }
      for (const target of result.targets)
        db.update(runTargets)
          .set({
            stats: target.stats,
            extrasBlocked: target.extrasBlocked,
            blockReasons: target.blockReasons,
          })
          .where(eq(runTargets.id, target.id))
          .run();
      db.update(runs)
        .set({
          status: forced ?? result.status,
          stopReason,
          errorCode,
          errorMessage: errorCode,
          stats: result.stats,
          endedAt: now,
          updatedAt: now,
          secretSnapshotEnc: null,
        })
        .where(eq(runs.id, id))
        .run();
    },
  );
}
/** 恢复入口在同一事务保存期限并废弃旧pending。
 * @param db 数据库。
 * @param id 原执行Run。
 * @returns recovering Run。
 * @throws Error 记录缺失或事务失败。
 */
export function recoveringRun(db: BetterSQLite3Database, id: string) {
  return db.transaction(
    /** 保留首次恢复期限并在同一事务废弃旧pending计划。
     * @param 不适用。
     * @returns recovering运行快照。
     * @throws Error 数据库失败。
     */
    () => {
      const run = db.select().from(runs).where(eq(runs.id, id)).get();
      if (!run) throw new Error('Recovery run missing');
      const now = Date.now();
      db.update(runs)
        .set({
          status: 'recovering',
          recoveryDeadlineAt:
            run.recoveryDeadlineAt ??
            now + run.config.settings.recoveryTimeoutSeconds * 1000,
          updatedAt: now,
        })
        .where(eq(runs.id, id))
        .run();
      db.update(operations)
        .set({
          status: 'skipped',
          errorCode: 'PLAN_INTERRUPTED',
          errorMessage: 'PLAN_INTERRUPTED',
          endedAt: now,
          updatedAt: now,
        })
        .where(and(eq(operations.runId, id), eq(operations.status, 'pending')))
        .run();
      return {
        ...run,
        status: 'recovering' as const,
        recoveryDeadlineAt:
          run.recoveryDeadlineAt ??
          now + run.config.settings.recoveryTimeoutSeconds * 1000,
      };
    },
  );
}
