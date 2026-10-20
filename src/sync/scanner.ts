// 深度优先逐目录扫描；递归帧保留待访问兄弟，计划仅保留一个写入批次。
import { setImmediate } from 'node:timers/promises';
import type { DirectoryView } from './scan-reader.js';
import { ScanReader } from './scan-reader.js';
import { PlanWriter } from './plan-writer.js';
import type { TargetState, PrepareDirectory } from './plan-writer.js';
import { JobFilter } from './filter.js';
import { collisions, compareDirectory } from './planner.js';
import type { Decision, Entry } from './planner.js';
import { addStat, PlanError } from './stats.js';

/** 当前源目录在一个 Target 上的对应状态。 */
interface TargetCursor {
  /** 目标累计事实。 */
  target: TargetState;
  /** 目标账号路径。 */
  path: string;
  /** 当前目录确认缺失。 */
  missing: boolean;
  /** 不可读取或被保护时不进入该分支。 */
  disabled: boolean;
  /** 延迟创建的父目录链。 */
  prepare?: PrepareDirectory;
  /** 已读取的根视图。 */
  view?: DirectoryView;
}
/** 一轮只读扫描，不执行计划中的 mkdir 或文件动作。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class Scanner {
  private readonly filter: JobFilter;
  private effectiveSource = 0;
  private ticks = 0;
  /** 保存固定的读写计划依赖。
   * @param reader 有界读取器。
   * @param writer 批量计划写入器。
   * @param signal Run 停止信号。
   * @returns 不适用。
   * @throws Error 模式编译失败。
   */
  constructor(
    private readonly reader: ScanReader,
    private readonly writer: PlanWriter,
    private readonly signal: AbortSignal,
  ) {
    this.filter = new JobFilter(writer.run.config.job.filters);
  }
  /** 为计时器和关机释放事件循环，不在文件循环中打印日志。
   * @param 不适用。
   * @returns 检查完成。
   * @throws Error 停止信号。
   */
  private async checkpoint(): Promise<void> {
    if (++this.ticks % 128 === 0) await setImmediate();
    this.signal.throwIfAborted();
  }
  /** 完成全部目录扫描及空源保护；未完整结束不标 planned。
   * @param 不适用。
   * @returns 扫描完成。
   * @throws PlanError 根不可用或资源上限；Error 本地失败或停止。
   */
  async scan(): Promise<void> {
    await this.reader.initialize();
    const source = this.writer.run.config.job.source;
    let root: DirectoryView;
    try {
      root = await this.reader.read(undefined, source.path);
    } catch (error) {
      this.reader.checkError(error);
      throw new PlanError('SOURCE_ROOT_UNAVAILABLE');
    }
    const cursors: TargetCursor[] = [];
    for (const target of this.writer.targets) {
      const view = await this.reader.root(target);
      const path = target.row.config.target.path;
      const prepare = view === null ? { path } : undefined;
      cursors.push({
        target,
        path,
        prepare,
        missing: view === null,
        disabled: view === undefined,
        view: view ?? undefined,
      });
    }
    await this.visitSource(source.path, '', 0, cursors, root);
    if (
      this.effectiveSource === 0 &&
      !this.writer.run.config.job.allowEmptySource
    )
      this.writer.issue(
        undefined,
        source.path,
        'EMPTY_SOURCE',
        false,
        false,
        true,
      );
    this.writer.flush();
  }
  /** 超深只保护对应子树并使相应扫描不完整。
   * @param target 目标或源。
   * @param path 超深路径。
   * @param depth 相对根深度。
   * @returns 是否超过上限。
   * @throws PlanError 问题数超限。
   */
  private depthExceeded(
    target: TargetState | undefined,
    path: string,
    depth: number,
  ): boolean {
    if (depth <= this.writer.run.config.settings.scanMaxDepth) return false;
    if (target) target.row.targetComplete = false;
    else
      for (const item of this.writer.targets) item.row.sourceComplete = false;
    this.writer.issue(target, path, 'SCAN_DEPTH_EXCEEDED', true, false, true);
    return true;
  }
  /** 遍历一个源目录；每目录先源，随后逐 Target，不重读源。
   * @param path 源账号路径。
   * @param relative 无前导斜杠的相对目录。
   * @param depth 目录深度。
   * @param cursors 各目标当前状态。
   * @param existing 已读取根视图，可省略。
   * @returns 遍历完成。
   * @throws PlanError 超限；Error 本地失败或停止。
   */
  private async visitSource(
    path: string,
    relative: string,
    depth: number,
    cursors: TargetCursor[],
    existing?: DirectoryView,
  ): Promise<void> {
    await this.checkpoint();
    if (this.depthExceeded(undefined, path, depth)) return;
    const view = existing ?? (await this.reader.subtree(undefined, path));
    if (!view) return;
    if (view.protectSubtree) {
      let files = 0;
      for (const entry of view.items) {
        addStat(
          this.writer.sourceStats,
          entry.isDir ? 'sourceDirectories' : 'sourceFiles',
        );
        if (!entry.isDir) files++;
        await this.checkpoint();
      }
      for (const cursor of cursors)
        if (!cursor.disabled)
          addStat(cursor.target.row.stats, 'protectedFiles', files);
      return;
    }
    if (depth > 0 && this.writer.run.config.job.syncEmptyDirs && !view.suspect)
      this.countEffectiveSource();
    // 可疑视图只禁止删除；已列出的源目录仍按目录结构新建。
    if (this.writer.run.config.job.syncEmptyDirs)
      for (const cursor of cursors)
        if (!cursor.disabled)
          this.writer.prepare(cursor.target, cursor.prepare);
    const sourceCollisions = collisions(view.items);
    const children = new Map<string, TargetCursor[]>();
    for (const entry of view.items) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      addStat(
        this.writer.sourceStats,
        entry.isDir ? 'sourceDirectories' : 'sourceFiles',
      );
      const fixedShare = path === '/' && entry.name.startsWith('@s');
      const excluded =
        fixedShare ||
        this.filter.excluded(rel, entry.isDir) ||
        (!entry.isDir &&
          (!this.filter.filePath(rel) ||
            (entry.size !== null && !this.filter.size(entry.size))));
      if (excluded && !entry.isDir)
        addStat(this.writer.sourceStats, 'filteredFiles');
      if (sourceCollisions.has(entry.name) && !fixedShare) {
        const issuePath = this.reader.child(undefined, path, entry.name);
        if (issuePath)
          this.writer.issue(
            undefined,
            issuePath,
            'NAME_COLLISION',
            entry.isDir,
          );
      } else if (!excluded) {
        if (entry.isDir) children.set(entry.name, []);
        if (!entry.isDir && entry.size === null) {
          const issuePath = this.reader.child(undefined, path, entry.name);
          if (issuePath)
            this.writer.issue(undefined, issuePath, 'UNKNOWN_SIZE', false);
        } else if (!view.suspect && !entry.isDir) {
          this.countEffectiveSource();
        }
      }
      await this.checkpoint();
    }
    const extras: {
      target: TargetState;
      path: string;
      relative: string;
      entry: Entry;
    }[] = [];
    for (const cursor of cursors) {
      const target = cursor.target;
      if (cursor.disabled) continue;
      const targetView = cursor.missing
        ? {
            items: [],
            suspect: false,
            trustMissing: true,
            protectedParent: false,
            protectSubtree: false,
          }
        : (cursor.view ?? (await this.reader.subtree(target, cursor.path)));
      if (!targetView) continue;
      for (const entry of targetView.items)
        if (!entry.isDir) addStat(target.row.stats, 'targetFiles');
      const decisions = compareDirectory(
        view.items,
        targetView.items,
        relative,
        this.filter,
        target.row.config.target.mode === 'mirror',
        view.suspect || targetView.suspect,
        path === '/',
        cursor.path === '/',
      );
      for (const compared of decisions) {
        await this.checkpoint();
        if (cursor.path === '/' && compared.name.startsWith('@s')) continue;
        // 不可写挂载范围不是“可疑但可新建”：整棵子树只计保护，不生成任何动作或递归。
        const decision: Decision =
          targetView.protectSubtree && compared.kind !== 'filtered'
            ? {
                ...compared,
                kind: 'protected',
                code: undefined,
                managed: false,
              }
            : compared;
        const targetPath = this.reader.child(
          target,
          cursor.path,
          decision.name,
        );
        if (!targetPath) continue;
        this.recordDecision(target, decision, path, targetPath);
        if (decision.kind === 'directory') {
          if (decision.source?.isDir) {
            const missing = !decision.target && targetView.trustMissing;
            const prepare = missing
              ? { path: targetPath, parent: cursor.prepare }
              : undefined;
            const child = {
              target,
              path: targetPath,
              missing,
              disabled: false,
              prepare,
            };
            children.get(decision.name)?.push(child);
            // 缺失父目录的证明必须完整；无法证明时下一层真实 list，不猜测。
          } else if (decision.target?.isDir && !view.suspect) {
            extras.push({
              target,
              path: targetPath,
              relative: decision.path,
              entry: decision.target,
            });
          }
        } else if (decision.kind === 'new' || decision.kind === 'replace') {
          const sourcePath = this.reader.child(undefined, path, decision.name);
          if (!sourcePath) continue;
          const parent = this.writer.prepare(target, cursor.prepare);
          const dependencies = parent ? [parent] : [];
          if (decision.kind === 'replace')
            dependencies.push(
              this.writer.operation(
                target,
                'delete',
                targetPath,
                'replace',
                undefined,
                undefined,
                decision.target,
              ),
            );
          this.writer.operation(
            target,
            'create',
            targetPath,
            decision.kind,
            decision.source,
            sourcePath,
            decision.target,
            dependencies,
          );
        } else if (decision.kind === 'extra')
          this.writer.operation(
            target,
            'delete',
            targetPath,
            'extra',
            undefined,
            undefined,
            decision.target,
          );
      }
    }
    for (const extra of extras)
      await this.targetOnly(
        extra.target,
        extra.path,
        extra.relative,
        depth + 1,
        extra.entry,
      );
    for (const [name, next] of children) {
      const child = this.reader.child(undefined, path, name);
      if (child)
        await this.visitSource(
          child,
          relative ? `${relative}/${name}` : name,
          depth + 1,
          next,
        );
    }
  }
  /** 累加比较事实和诊断，保护路径不生成变更 Operation。
   * @param target 目标。
   * @param decision 比较结果。
   * @param sourceParent 源父路径。
   * @param targetPath 目标路径。
   * @returns 不适用。
   * @throws PlanError 超限；Error 本地失败。
   */
  private recordDecision(
    target: TargetState,
    decision: Decision,
    sourceParent: string,
    targetPath: string,
  ): void {
    if (decision.managed) {
      target.row.observedTargetFileCount++;
      if (!Number.isSafeInteger(target.row.observedTargetFileCount))
        throw new PlanError('RESOURCE_LIMIT');
    }
    const file =
      (decision.source && !decision.source.isDir) ||
      (decision.target && !decision.target.isDir);
    if (decision.kind === 'unchanged')
      addStat(target.row.stats, 'unchangedFiles');
    if (decision.kind === 'filtered' && file)
      addStat(target.row.stats, 'filteredFiles');
    if (decision.kind === 'protected' && file)
      addStat(target.row.stats, 'protectedFiles');
    if (decision.code) {
      const sourcePath = decision.sourceIssue
        ? this.reader.child(undefined, sourceParent, decision.name)
        : undefined;
      if (!decision.sourceIssue || sourcePath)
        this.writer.issue(
          decision.sourceIssue ? undefined : target,
          sourcePath ?? targetPath,
          decision.code,
          decision.source?.isDir === true || decision.target?.isDir === true,
          decision.warning === true,
        );
    }
  }
  /** 累加已确认且未受保护的源文件或允许同步的源子目录。
   * @param 不适用。
   * @returns 不适用。
   * @throws PlanError 计数溢出。
   */
  private countEffectiveSource(): void {
    this.effectiveSource++;
    if (!Number.isSafeInteger(this.effectiveSource))
      throw new PlanError('RESOURCE_LIMIT');
  }
  /** 枚举目标独有树，即使 incremental 也计算 D；空目录候选后序写入。
   * @param target 目标。
   * @param path 账号目录。
   * @param relative 相对目录。
   * @param depth 深度。
   * @param directory 父列表中的目录事实。
   * @returns 是否无受保护后代，可规划祖先空目录删除。
   * @throws PlanError 超限；Error 本地失败或停止。
   */
  private async targetOnly(
    target: TargetState,
    path: string,
    relative: string,
    depth: number,
    directory: Entry,
  ): Promise<boolean> {
    await this.checkpoint();
    if (this.depthExceeded(target, path, depth)) return false;
    const view = await this.reader.subtree(target, path);
    if (!view) return false;
    if (view.protectSubtree) return false;
    let clean = !view.suspect && !view.protectedParent;
    for (const entry of view.items)
      if (!entry.isDir) addStat(target.row.stats, 'targetFiles');
    for (const decision of compareDirectory(
      [],
      view.items,
      relative,
      this.filter,
      target.row.config.target.mode === 'mirror',
      view.suspect,
    )) {
      await this.checkpoint();
      const child = this.reader.child(target, path, decision.name);
      if (!child) {
        clean = false;
        continue;
      }
      this.recordDecision(target, decision, '', child);
      if (decision.kind === 'directory' && decision.target) {
        if (
          !(await this.targetOnly(
            target,
            child,
            decision.path,
            depth + 1,
            decision.target,
          ))
        )
          clean = false;
      } else if (decision.kind === 'extra')
        this.writer.operation(
          target,
          'delete',
          child,
          'extra',
          undefined,
          undefined,
          decision.target,
        );
      else clean = false;
    }
    if (
      clean &&
      target.row.config.target.mode === 'mirror' &&
      this.writer.run.config.job.syncEmptyDirs
    )
      this.writer.operation(
        target,
        'delete',
        path,
        'extra',
        undefined,
        undefined,
        directory,
      );
    return clean;
  }
}
