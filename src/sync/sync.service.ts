// 编排扫描和后置安全检查，预览收尾或向执行阶段交付完整计划。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, count, eq, gt, inArray } from 'drizzle-orm';
import { setImmediate } from 'node:timers/promises';
import { DatabaseService } from '../database/database.service.js';
import { runTargets, runs, runRetryItems } from '../database/run-schema.js';
import type { RunRecord } from '../database/run-schema.js';
import {
  operations,
  operationDependencies,
} from '../database/operation-schema.js';
import { OpenListClient } from '../openlist/client.service.js';
import { KeysService } from '../security/keys.service.js';
import type { PathSecrets } from '../jobs/job-types.js';
import { PlanWriter } from './plan-writer.js';
import { ScanReader } from './scan-reader.js';
import { ScanScope } from './scan-scope.js';
import { Scanner } from './scanner.js';
import { deletionSafety } from './safety.js';
import { objectInput } from '../jobs/validation.js';
import { endOperations } from '../database/operation-records.js';

/** 完整计划与安全边界，真实文件写入由Executor执行。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  /** 保存扫描依赖。
   * @param database 数据库。
   * @param client 扫描协议客户端。
   * @param keys 路径密码解密。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(OpenListClient) private readonly client: OpenListClient,
    @Inject(KeysService) private readonly keys: KeysService,
  ) {}
  /** 执行一次扫描、固定完整计划，再完成安全计算和预览终态。
   * @param run 已取得执行位的 Run。
   * @param signal 本次停止信号。
   * @returns 工作完成。
   * @throws PlanError 预期扫描失败；Error 取消、本地或数据库失败。
   */
  async preview(run: RunRecord, signal: AbortSignal): Promise<void> {
    const db = this.database.db;
    const targets = db
      .select()
      .from(runTargets)
      .where(eq(runTargets.runId, run.id))
      .all()
      .map(
        /** 为 Run Target 记录建立扫描累计状态，完整性标志初始为 true。
         * @param row Run Target 记录。
         * @returns 本次扫描的目标状态。
         * @throws 不适用。
         */
        (row) => ({
          row: { ...row, sourceComplete: true, targetComplete: true },
          rootMissing: false,
        }),
      );
    targets.sort(
      /** 按快照中的目标 position 升序比较两个目标状态。
       * @param a 左侧目标状态。
       * @param b 右侧目标状态。
       * @returns 负数、零或正数表示的排序关系。
       * @throws 不适用。
       */
      (a, b) => a.row.config.target.position - b.row.config.target.position,
    );
    const writer = new PlanWriter(db, run, targets, signal);
    const reader = new ScanReader(
      db,
      this.client,
      writer,
      this.secrets(run),
      signal,
    );
    const scope =
      run.retryOfRunId === null
        ? undefined
        : new ScanScope(
            db
              .select()
              .from(runRetryItems)
              .where(eq(runRetryItems.runId, run.id))
              .all(),
          );
    await new Scanner(reader, writer, signal, scope).scan();
    signal.throwIfAborted();
    db.transaction(
      /** 在一个事务内标记扫描完成、写入剩余计划并将 Run 置为 planned。
       * @param 不适用。
       * @returns 不适用。
       * @throws PlanError 统计溢出；Error 已停止、依赖非法或数据库失败。
       */
      () => {
        writer.completeScan();
        writer.flush();
        db.update(runs)
          .set({
            status: 'planned',
            scanCompletedAt: Date.now(),
            updatedAt: Date.now(),
          })
          .where(eq(runs.id, run.id))
          .run();
      },
    );
    for (const target of targets) {
      signal.throwIfAborted();
      const row = target.row;
      const safety = deletionSafety(
        row.observedTargetFileCount,
        row.plannedReplaceCount,
        row.plannedExtraCount,
        row.config.target.deleteLimits,
        run.confirmDeletes,
        row.deleteBlocked,
      );
      if (safety.invalidPlan) {
        writer.issue(
          target,
          row.config.target.path,
          'PLAN_INVALID',
          false,
          false,
          true,
        );
        this.logger.error('Invalid deletion plan', {
          runId: run.id,
          runTargetId: row.id,
          errorCode: 'PLAN_INVALID',
        });
      }
      row.deleteBudgetCount = safety.budget;
      if (safety.code) {
        row.deleteBlocked = true;
        row.extrasBlocked = true;
        if (
          safety.code === 'DELETE_LIMIT' &&
          !row.blockReasons.includes('DELETE_LIMIT')
        )
          row.blockReasons.push('DELETE_LIMIT');
      }
      await this.skipDeletes(
        run,
        row.id,
        safety.code,
        row.extrasBlocked,
        signal,
      );
      row.stats.skippedOperations =
        db
          .select({ n: count() })
          .from(operations)
          .where(
            and(
              eq(operations.runTargetId, row.id),
              eq(operations.status, 'skipped'),
            ),
          )
          .get()?.n ?? 0;
    }
    signal.throwIfAborted();
    const executable =
      db
        .select({ id: operations.id })
        .from(operations)
        .where(
          and(eq(operations.runId, run.id), eq(operations.status, 'pending')),
        )
        .limit(1)
        .get() !== undefined;
    const terminal = run.dryRun || !executable;
    db.transaction(
      /** 在一个事务内写入安全检查产生的诊断与目标状态，并保存 Run 预览终态、清除秘密快照。
       * @param 不适用。
       * @returns 不适用。
       * @throws PlanError 统计溢出；Error 已停止、依赖非法或数据库失败。
       */
      () => {
        writer.flush();
        db.update(runs)
          .set({
            status: !terminal
              ? 'executing'
              : targets.some(
                    /** 检查目标是否存在阻断原因。
                     * @param target 目标扫描状态。
                     * @returns 是否有阻断原因，有则 Run 为 partial。
                     * @throws 不适用。
                     */
                    (target) => target.row.blockReasons.length > 0,
                  )
                ? 'partial'
                : 'succeeded',
            stats: writer.stats(),
            endedAt: terminal ? Date.now() : null,
            updatedAt: Date.now(),
            secretSnapshotEnc: terminal ? null : run.secretSnapshotEnc,
          })
          .where(eq(runs.id, run.id))
          .run();
      },
    );
  }
  /** 批量跳过扫描阻断或阈值拒绝的删除及依赖 create。
   * @param run 当前 Run。
   * @param targetId Run Target ID。
   * @param code 全目标删除拒绝码；null 表示仅可能阻断 extras。
   * @param extrasBlocked 是否禁止 extras。
   * @param signal 停止信号。
   * @returns 状态更新完成。
   * @throws Error 数据库失败或停止。
   */
  private async skipDeletes(
    run: RunRecord,
    targetId: string,
    code: 'DELETE_BLOCKED' | 'DELETE_LIMIT' | null,
    extrasBlocked: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    if (!code && !extrasBlocked) return;
    const db = this.database.db;
    let seq = 0;
    for (;;) {
      await setImmediate();
      signal.throwIfAborted();
      const rows = db
        .select({ id: operations.id, seq: operations.seq })
        .from(operations)
        .where(
          and(
            eq(operations.runTargetId, targetId),
            eq(operations.status, 'pending'),
            eq(operations.action, 'delete'),
            gt(operations.seq, seq),
            code ? undefined : eq(operations.reason, 'extra'),
          ),
        )
        .orderBy(asc(operations.seq))
        .limit(run.config.settings.planBatchSize)
        .all();
      if (rows.length === 0) return;
      const ids = rows.map(
        /** 取出本批 delete 操作的 ID。
         * @param row 本批 delete 操作的 ID 与 seq。
         * @returns 操作 ID。
         * @throws 不适用。
         */
        (row) => row.id,
      );
      seq = rows[rows.length - 1].seq;
      db.transaction(
        /** 在一个事务内将本批仍 pending 的 delete 及依赖它们的操作标记为 skipped。
         * @param 不适用。
         * @returns 不适用。
         * @throws Error 数据库失败。
         */
        () => {
          const dependents = db
            .select({ id: operationDependencies.operationId })
            .from(operationDependencies)
            .where(inArray(operationDependencies.dependsOnId, ids))
            .all();
          // 只读取本批反向依赖并逐主键更新；OR 子查询会让 SQLite 每批扫描整个 Run 或 pending 集合。
          for (const row of [...rows, ...dependents])
            endOperations(
              db,
              and(
                eq(operations.runId, run.id),
                eq(operations.status, 'pending'),
                eq(operations.id, row.id),
              ),
              { status: 'skipped', code: code ?? 'DELETE_BLOCKED' },
            );
        },
      );
    }
  }
  /** 解密独立运行密码快照，不回读 Job 当前密码。
   * @param run 固定运行记录。
   * @returns 内存路径密码。
   * @throws Error 密文或快照结构错误。
   */
  private secrets(run: RunRecord): PathSecrets {
    if (run.secretSnapshotEnc === null)
      return { sourcePassword: null, targetPasswords: {} };
    const parsed: unknown = JSON.parse(
      this.keys.decrypt(run.secretSnapshotEnc, {
        table: 'runs',
        recordId: run.id,
        field: 'secret_snapshot_enc',
      }),
    );
    const value = objectInput(
      parsed,
      ['sourcePassword', 'targetPasswords'],
      'secretSnapshot',
    );
    if (
      value.sourcePassword !== null &&
      typeof value.sourcePassword !== 'string'
    )
      throw new Error('Invalid source password snapshot');
    if (
      value.targetPasswords === null ||
      typeof value.targetPasswords !== 'object' ||
      Array.isArray(value.targetPasswords)
    )
      throw new Error('Invalid target passwords snapshot');
    const targetPasswords: Record<string, string | null> = {};
    for (const [id, password] of Object.entries(value.targetPasswords)) {
      if (password !== null && typeof password !== 'string')
        throw new Error('Invalid target password snapshot');
      targetPasswords[id] = password;
    }
    return { sourcePassword: value.sourcePassword, targetPasswords };
  }
}
