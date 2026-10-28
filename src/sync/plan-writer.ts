// 有界批量保存计划、依赖与去重诊断，始终先于任何终态事务。
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  operations,
  operationDependencies,
} from '../database/operation-schema.js';
import {
  runs,
  runTargets,
  scanIssues,
  runRetryItems,
} from '../database/run-schema.js';
import type {
  RunRecord,
  RunTargetRecord,
  RunRetryItemRecord,
} from '../database/run-schema.js';
import { addStat, emptyStats, PlanError } from './stats.js';
import type { Stats } from './stats.js';
import type { Entry } from './planner.js';

/** 扫描期间每目标的有界累计状态。 */
export interface TargetState {
  /** 持久化目标事实的当前值。 */
  row: RunTargetRecord;
  /** 根是否被证明缺失。 */
  rootMissing: boolean;
}
/** 尚未必要时不生成 mkdir 的目录链，仅保留当前递归路径。 */
export interface PrepareDirectory {
  /** 目标绝对路径。 */
  path: string;
  /** 父目录准备。 */
  parent?: PrepareDirectory;
  /** 已创建的计划 ID。 */
  operationId?: string;
}
/** 一个有界批次的操作及依赖。 */
interface PendingOperation {
  /** 操作字段。 */
  row: typeof operations.$inferInsert;
  /** 必须先成功的早先操作 ID。 */
  dependencies: string[];
}

/** Run 的计划写入器，内存仅保留一个批次。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class PlanWriter {
  readonly sourceStats = emptyStats();
  private pending: PendingOperation[] = [];
  private issues: (typeof scanIssues.$inferInsert)[] = [];
  private scopeUpdates: RunRetryItemRecord[] = [];
  private operationCount = 0;
  private issueCount = 0;
  private scanComplete = false;
  /** 保存本次 Run 依赖。
   * @param db SQLite 连接。
   * @param run 固定运行记录。
   * @param targets 所有目标累计值。
   * @param signal 扫描停止信号。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    private readonly db: BetterSQLite3Database,
    readonly run: RunRecord,
    readonly targets: TargetState[],
    private readonly signal: AbortSignal,
  ) {}
  /** 追加计划，seq 是整个 Run 的持久化顺序。
   * @param target 目标累计值。
   * @param action mkdir/create/delete。
   * @param path 目标绝对路径。
   * @param reason 计划动机。
   * @param source 源条目，create 必填。
   * @param sourcePath create 的源路径。
   * @param old 目标原条目。
   * @param dependencies 已规划的必要依赖。
   * @returns 新操作 ID。
   * @throws PlanError 超限；Error 数据库或依赖失败。
   */
  operation(
    target: TargetState,
    action: 'mkdir' | 'create' | 'delete',
    path: string,
    reason: 'prepare' | 'new' | 'replace' | 'extra',
    source?: Entry,
    sourcePath?: string,
    old?: Entry,
    dependencies: string[] = [],
  ): string {
    this.signal.throwIfAborted();
    if (this.operationCount >= this.run.config.settings.maxOperationsPerRun)
      throw new PlanError('RESOURCE_LIMIT');
    const id = randomUUID();
    const now = Date.now();
    const isDir = action === 'mkdir' || old?.isDir === true;
    const size = action === 'create' ? source?.size : old?.size;
    if (!isDir && (size === null || size === undefined))
      throw new Error('Unknown operation size');
    this.pending.push({
      row: {
        id,
        runId: this.run.id,
        runTargetId: target.row.id,
        seq: ++this.operationCount,
        action,
        method:
          action === 'create'
            ? target.row.config.target.createMode
            : action === 'mkdir'
              ? 'mkdir'
              : 'remove',
        reason,
        sourceInstanceId:
          action === 'create' ? this.run.config.job.source.instanceId : null,
        sourcePath: action === 'create' ? sourcePath : null,
        targetInstanceId: target.row.config.target.instanceId,
        targetPath: path,
        isDir,
        expectedSourceSize: source?.size ?? null,
        expectedTargetSize: old?.size ?? null,
        expectedSourceModified: source?.modified ?? null,
        affectedFileCount: isDir ? 0 : 1,
        affectedBytes: isDir ? 0 : (size ?? 0),
        createdAt: now,
        updatedAt: now,
        status: 'pending',
      },
      dependencies,
    });
    if (action === 'create') {
      addStat(target.row.stats, 'plannedCreates');
      addStat(target.row.stats, 'plannedBytes', source?.size ?? 0);
    }
    if (action === 'delete') {
      if (isDir) addStat(target.row.stats, 'plannedDirectoryDeletes');
      else if (reason === 'replace') {
        addStat(target.row.stats, 'plannedReplacements');
        target.row.plannedReplaceCount++;
      } else {
        addStat(target.row.stats, 'plannedExtraDeletes');
        target.row.plannedExtraCount++;
      }
    }
    this.maybeFlush();
    return id;
  }
  /** 在确有子创建时递归规划父目录，根提示只生成一次。
   * @param target 所属目标。
   * @param directory 可省略的缺失目录链。
   * @returns 直接父 mkdir ID 或 undefined。
   * @throws PlanError 超限；Error 数据库失败。
   */
  async prepare(
    target: TargetState,
    directory?: PrepareDirectory,
  ): Promise<string | undefined> {
    if (!directory) return undefined;
    if (directory.operationId) return directory.operationId;
    const parent = await this.prepare(target, directory.parent);
    directory.operationId = this.operation(
      target,
      'mkdir',
      directory.path,
      'prepare',
      undefined,
      undefined,
      undefined,
      parent ? [parent] : [],
    );
    if (
      this.run.dryRun &&
      target.rootMissing &&
      directory.path === target.row.config.target.path
    )
      this.issue(
        target,
        directory.path,
        'TARGET_ROOT_WILL_BE_CREATED',
        false,
        true,
      );
    return directory.operationId;
  }
  /** 去重并保存诊断；提示/警告不进入 blockReasons。
   * @param target 目标；undefined 表示源问题。
   * @param path 账号内路径。
   * @param code 原因码。
   * @param protectSubtree 是否保护子树。
   * @param warning 是否为非降级提示。
   * @param blockDeletes 是否阻断相应目标全部删除。
   * @returns 不适用。
   * @throws PlanError 诊断超限；Error 数据库失败。
   */
  issue(
    target: TargetState | undefined,
    path: string,
    code: string,
    protectSubtree: boolean,
    warning = false,
    blockDeletes = false,
  ): void {
    const affected = target ? [target] : this.targets;
    if (!warning)
      for (const t of affected) {
        if (!t.row.blockReasons.includes(code)) t.row.blockReasons.push(code);
        t.row.extrasBlocked = true;
        if (blockDeletes) t.row.deleteBlocked = true;
        if (code === 'SUSPECT_VIEW' || code === 'MOUNT_BOUNDARY_UNKNOWN')
          t.row.suspect = true;
      }
    const targetId = target?.row.id ?? null;
    if (
      this.issues.some(
        /** 检查本批待写诊断中是否已有同目标、同路径、同原因码的条目。
         * @param issue 本批待写诊断。
         * @returns 是否重复。
         * @throws 不适用。
         */
        (issue) =>
          issue.runTargetId === targetId &&
          issue.path === path &&
          issue.code === code,
      )
    )
      return;
    if (
      this.db
        .select({ id: scanIssues.id })
        .from(scanIssues)
        .where(
          and(
            eq(scanIssues.runId, this.run.id),
            targetId === null
              ? isNull(scanIssues.runTargetId)
              : eq(scanIssues.runTargetId, targetId),
            eq(scanIssues.path, path),
            eq(scanIssues.code, code),
          ),
        )
        .limit(1)
        .get()
    )
      return;
    if (this.issueCount >= this.run.config.settings.maxScanIssuesPerRun)
      throw new PlanError('RESOURCE_LIMIT');
    this.issueCount++;
    this.issues.push({
      id: randomUUID(),
      runId: this.run.id,
      runTargetId: targetId,
      endpointRole: target ? 'target' : 'source',
      instanceId:
        target?.row.config.target.instanceId ??
        this.run.config.job.source.instanceId,
      path,
      code,
      message: code,
      protectSubtree,
      createdAt: Date.now(),
    });
    this.maybeFlush();
  }
  /** 形成 Run 统计，源只计一次，其余目标字段求和。
   * @param 不适用。
   * @returns 当前统计。
   * @throws PlanError 统计溢出。
   */
  stats(): Stats {
    const result = { ...this.sourceStats };
    for (const target of this.targets)
      for (const key of Object.keys(target.row.stats) as (keyof Stats)[]) {
        if (
          key !== 'sourceFiles' &&
          key !== 'sourceDirectories' &&
          key !== 'filteredFiles'
        )
          addStat(result, key, target.row.stats[key]);
      }
    return result;
  }
  /** 保存一个输入的扫描结论；执行状态仍由Operation记录。
   * @param item 当前范围项。
   * @param outcome 扫描结论，不接受未处理状态。
   * @returns 不适用。
   * @throws Error 重复结论或数据库失败。
   */
  scopeOutcome(
    item: RunRetryItemRecord,
    outcome: Exclude<RunRetryItemRecord['scanOutcome'], 'unprocessed'>,
  ): void {
    if (item.scanOutcome !== 'unprocessed')
      throw new Error('Retry input already processed');
    item.scanOutcome = outcome;
    this.scopeUpdates.push(item);
    this.maybeFlush();
  }
  /** 达到批次上限即落库。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  private maybeFlush(): void {
    if (
      this.pending.length + this.issues.length + this.scopeUpdates.length >=
      this.run.config.settings.planBatchSize
    )
      this.flush();
  }
  /** 只在完整遍历结束后允许公开完整性结论。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  completeScan(): void {
    this.scanComplete = true;
  }
  /** 提交短事务；依赖必须指向同 Run 更早的 seq，因此无法成环。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 数据库或依赖错误；PlanError 统计溢出。
   */
  flush(): void {
    this.signal.throwIfAborted();
    // 各目标展示共享源扫描事实，Run 聚合时不重复累加这些字段。
    for (const target of this.targets) {
      target.row.stats.sourceFiles = this.sourceStats.sourceFiles;
      target.row.stats.sourceDirectories = this.sourceStats.sourceDirectories;
    }
    const stats = this.stats();
    this.db.transaction(
      /** 在一个事务内写入本批操作及已校验的依赖、诊断、各目标状态和 Run 统计。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 依赖不指向同 Run 同目标更早的 seq，或数据库失败。
       */
      () => {
        for (const op of this.pending) {
          this.db.insert(operations).values(op.row).run();
          for (const parent of op.dependencies) {
            const dependency = this.db
              .select()
              .from(operations)
              .where(eq(operations.id, parent))
              .get();
            if (
              !dependency ||
              dependency.runId !== this.run.id ||
              dependency.runTargetId !== op.row.runTargetId ||
              dependency.seq >= op.row.seq
            )
              throw new Error('Invalid operation dependency');
            this.db
              .insert(operationDependencies)
              .values({ operationId: op.row.id, dependsOnId: parent })
              .run();
          }
        }
        for (const item of this.scopeUpdates)
          this.db
            .update(runRetryItems)
            .set({ scanOutcome: item.scanOutcome })
            .where(
              and(
                eq(runRetryItems.runId, this.run.id),
                eq(runRetryItems.runTargetId, item.runTargetId),
                eq(runRetryItems.relativePath, item.relativePath),
              ),
            )
            .run();
        for (const issue of this.issues)
          this.db.insert(scanIssues).values(issue).run();
        for (const target of this.targets)
          this.db
            .update(runTargets)
            .set({
              ...target.row,
              sourceComplete: this.scanComplete && target.row.sourceComplete,
              targetComplete: this.scanComplete && target.row.targetComplete,
            })
            .where(eq(runTargets.id, target.row.id))
            .run();
        this.db
          .update(runs)
          .set({ stats, updatedAt: Date.now() })
          .where(eq(runs.id, this.run.id))
          .run();
      },
    );
    this.pending = [];
    this.issues = [];
    this.scopeUpdates = [];
  }
}
