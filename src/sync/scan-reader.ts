// 读取当前目录并映射挂载、协议和根存在性事实，不把上游错误当缺失。
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { instances } from '../database/schema.js';
import type { InstanceRecord } from '../database/schema.js';
import type { FileList } from '../openlist/protocol.js';
import type { OpenListClient } from '../openlist/client.service.js';
import { OpenListError } from '../openlist/errors.js';
import { childPath, globalPath } from '../openlist/paths.js';
import { resolveMount } from '../openlist/mounts.js';
import type { Storage } from '../openlist/mounts.js';
import type { Entry } from './planner.js';
import type { PathSecrets } from '../jobs/job-types.js';
import type { PlanWriter, TargetState } from './plan-writer.js';
import { PlanError } from './stats.js';
import type { QuarantineObserver } from './quarantine-observer.js';
import { ApiError } from '../common/errors.js';

/** 一个完整响应的目录事实。 */
export interface DirectoryView {
  /** 合法原名条目，包含过滤前全集。 */
  items: Entry[];
  /** 当前目录局部视图可疑。 */
  suspect: boolean;
  /** 是否允许依据缺名建立目录缺失快速路径。 */
  trustMissing: boolean;
  /** 非法名称导致该目录及危险祖先不能被删除。 */
  protectedParent: boolean;
  /** 无唯一可用 storage 的已知范围，不能通过下探重新开放其后代。 */
  protectSubtree: boolean;
}
/** 一个 Run 内共享的完整挂载映射和目录读取。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class ScanReader {
  private readonly logger = new Logger(ScanReader.name);
  private readonly mounts = new Map<string, Storage[] | null>();
  /** 保存只读客户端和快照。
   * @param db 数据库。
   * @param client OpenList 读取客户端。
   * @param writer 计划及诊断。
   * @param secrets 路径密码，仅内存。
   * @param signal Run 停止信号。
   * @param quarantine 当前Run的分页隔离检查与强制观察能力。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    private readonly db: BetterSQLite3Database,
    private readonly client: OpenListClient,
    private readonly writer: PlanWriter,
    private readonly secrets: PathSecrets,
    private readonly signal: AbortSignal,
    readonly quarantine: QuarantineObserver,
  ) {}
  /** 加载每个管理员实例的完整挂载映射一次（客户端允许一次不一致重读）。
   * @param 不适用。
   * @returns 加载完成。
   * @throws PlanError 资源超限；Error 数据库或停止。
   */
  async initialize(): Promise<void> {
    for (const snapshot of Object.values(this.writer.run.config.instances)) {
      if (snapshot.accountRole !== 2) continue;
      try {
        const mounts = await this.client.storages(this.instance(snapshot.id), {
          signal: this.signal,
          settings: this.writer.run.config.settings,
        });
        this.mounts.set(snapshot.id, mounts);
      } catch (error) {
        this.checkError(error);
        this.mounts.set(snapshot.id, null);
        if (snapshot.id === this.writer.run.config.job.source.instanceId)
          this.writer.issue(
            undefined,
            this.writer.run.config.job.source.path,
            'MOUNT_BOUNDARY_UNKNOWN',
            false,
            false,
            true,
          );
        for (const target of this.writer.targets)
          if (target.row.config.target.instanceId === snapshot.id)
            this.writer.issue(
              target,
              target.row.config.target.path,
              'MOUNT_BOUNDARY_UNKNOWN',
              false,
              false,
              true,
            );
      }
    }
  }
  /** 取得当前凭据并保留固定的非秘密连接配置。
   * @param id 实例 ID。
   * @returns 客户端需要的内部配置。
   * @throws Error 缺失引用或数据库失败。
   */
  private instance(id: string): InstanceRecord {
    const current = this.db
      .select()
      .from(instances)
      .where(eq(instances.id, id))
      .get();
    const snapshot = this.writer.run.config.instances[id];
    if (!current || !snapshot) throw new Error('Run instance missing');
    return { ...current, ...snapshot, ...snapshot.limits };
  }
  /** 判断错误是否可映射为扫描问题；资源和本地错误向上抛出。
   * @param error 读取异常。
   * @returns 不适用，正常返回表示上游不可用。
   * @throws PlanError 资源超限；Error 本地异常或停止。
   */
  checkError(error: unknown): void {
    this.signal.throwIfAborted();
    if (
      error instanceof OpenListError &&
      (error.code === 'UPSTREAM_JSON_TOO_LARGE' ||
        error.code === 'RESOURCE_LIMIT')
    )
      throw new PlanError('RESOURCE_LIMIT');
    if (!(error instanceof OpenListError) && !(error instanceof ApiError))
      throw error;
  }
  /** 读取单个完整目录，始终使用快照设置和端点密码。
   * @param target 目标，undefined 表示源。
   * @param path 账号目录。
   * @param refresh 覆盖普通扫描 refresh（仅根父目录证明使用 false）。
   * @returns 目录事实。
   * @throws OpenListError 上游失败；PlanError 超限；Error 本地错误。
   */
  async read(
    target: TargetState | undefined,
    path: string,
    refresh?: boolean,
  ): Promise<DirectoryView> {
    this.signal.throwIfAborted();
    const endpoint =
      target?.row.config.target ?? this.writer.run.config.job.source;
    const snapshot = this.writer.run.config.instances[endpoint.instanceId];
    if (!snapshot) throw new Error('Endpoint snapshot missing');
    const password = target
      ? this.secrets.targetPasswords[target.row.targetId]
      : this.secrets.sourcePassword;
    const forced = target && this.quarantine.refresh(target.row, path);
    const context = {
      signal: this.signal,
      settings: this.writer.run.config.settings,
    };
    let list: FileList;
    try {
      list = await this.client.list(
        this.instance(endpoint.instanceId),
        path,
        password ?? '',
        forced ? true : (refresh ?? endpoint.refresh),
        context,
      );
    } catch (error) {
      this.signal.throwIfAborted();
      if (
        !forced ||
        (refresh ?? endpoint.refresh) ||
        !(error instanceof OpenListError)
      )
        throw error;
      // 普通缓存扫描仍可服务不受影响的兄弟；隔离动作在allows中必须重新刷新成功，不能使用此回退视图获准写入。
      this.logger.warn('Required quarantine refresh unavailable', {
        runId: this.writer.run.id,
        errorCode: error.code,
      });
      list = await this.client.list(
        this.instance(endpoint.instanceId),
        path,
        password ?? '',
        false,
        context,
      );
    }
    this.signal.throwIfAborted();
    const mounts = this.mounts.get(endpoint.instanceId);
    const resolution = mounts
      ? resolveMount(mounts, globalPath(snapshot.accountBasePath, path))
      : undefined;
    const suspect =
      resolution?.suspect === true ||
      (snapshot.accountRole !== 2 &&
        [...list.items, ...list.protectedEntries].some(
          /** 检查非管理员视图中的条目是否带挂载提示。
           * @param entry 列表条目，含排除的根分享条目。
           * @returns 是否携带挂载提示。
           * @throws 不适用。
           */
          (entry) => entry.mountDetails,
        ));
    // 完整映射内的不可用/歧义 storage 只保护其范围，不能回退父挂载。
    const unavailableMount =
      resolution !== undefined &&
      resolution.storage === null &&
      (resolution.candidates.length > 0 || !resolution.suspect);
    // 已有空目录可能没有任何后续候选；仍需在比较前观察其旧mkdir责任。
    if (target && forced && mounts !== null && !suspect && !unavailableMount)
      await this.quarantine.allows(target.row, path, 'mkdir');
    // 一次写入最终保护范围；先写局部问题再写整树问题会被相同路径/码去重。
    if (suspect || unavailableMount)
      this.writer.issue(target, path, 'SUSPECT_VIEW', unavailableMount);
    const invalidName = list.warnings.some(
      /** 检查列表警告是否为真实非法名称，排除固定的根分享条目。
       * @param warning 列表警告。
       * @returns 是否为非分享排除的 INVALID_NAME。
       * @throws 不适用。
       */
      (warning) =>
        warning.code === 'INVALID_NAME' && warning.fact !== 'share_excluded',
    );
    if (invalidName)
      this.writer.issue(
        target,
        path,
        'INVALID_NAME',
        false,
        target !== undefined,
      );
    return {
      items: [...list.items, ...list.protectedEntries].map(
        /** 仅保留规划事实，立即丢弃下载签名。
         * @param entry 已验证条目。
         * @returns 不含 sign 的原名、类型、大小和时间。
         * @throws 不适用。
         */
        (entry) => ({
          name: entry.name,
          size: entry.size,
          isDir: entry.isDir,
          modified: entry.modified,
        }),
      ),
      suspect: suspect || unavailableMount,
      trustMissing: mounts !== null && !suspect && !unavailableMount,
      protectedParent: invalidName,
      protectSubtree: unavailableMount,
    };
  }
  /** 核实目标根；只允许完整非可疑父列表证明缺失。
   * @param target 所属目标。
   * @returns 已有目录视图、null 表示缺失、undefined 表示不可用。
   * @throws PlanError 资源超限；Error 本地错误或停止。
   */
  async root(target: TargetState): Promise<DirectoryView | null | undefined> {
    const path = target.row.config.target.path;
    try {
      return await this.read(target, path);
    } catch (error) {
      this.checkError(error);
      const forbidden =
        error instanceof OpenListError &&
        (error.code === 'AUTH_BLOCKED' ||
          error.httpStatus === 403 ||
          error.upstreamCode === 403 ||
          error.httpStatus === 401 ||
          error.upstreamCode === 401);
      if (path !== '/' && !forbidden) {
        const split = path.lastIndexOf('/');
        const parent = path.slice(0, split) || '/';
        const name = path.slice(split + 1);
        try {
          const view = await this.read(target, parent, false);
          if (
            view.trustMissing &&
            !view.items.some(
              /** 检查父目录列表中是否存在目标根原名。
               * @param entry 父目录条目。
               * @returns 是否与目标根同名。
               * @throws 不适用。
               */
              (entry) => entry.name === name,
            )
          ) {
            target.rootMissing = true;
            return null;
          }
        } catch (parentError) {
          this.checkError(parentError);
        }
      }
      target.row.targetComplete = false;
      this.writer.issue(
        target,
        path,
        'TARGET_ROOT_UNAVAILABLE',
        true,
        false,
        true,
      );
      return undefined;
    }
  }
  /** 子目录读取失败只记录完整性问题，绝不猜测缺失。
   * @param target 所属目标或源。
   * @param path 目录。
   * @returns 完整视图或 undefined。
   * @throws PlanError 资源超限；Error 本地错误或停止。
   */
  async subtree(
    target: TargetState | undefined,
    path: string,
  ): Promise<DirectoryView | undefined> {
    try {
      return await this.read(target, path);
    } catch (error) {
      this.checkError(error);
      if (target) target.row.targetComplete = false;
      else
        for (const item of this.writer.targets) item.row.sourceComplete = false;
      this.writer.issue(target, path, 'SCAN_INCOMPLETE', true, false, true);
      return undefined;
    }
  }
  /** 安全拼接列表原名；超长完整路径按不完整子树处理。
   * @param target 目标或源。
   * @param parent 父目录。
   * @param name 合法原名。
   * @returns 子路径或 undefined。
   * @throws Error 非路径错误。
   */
  child(
    target: TargetState | undefined,
    parent: string,
    name: string,
  ): string | undefined {
    try {
      return childPath(parent, name);
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'INVALID_PATH')
        throw error;
      if (target) target.row.targetComplete = false;
      else
        for (const item of this.writer.targets) item.row.sourceComplete = false;
      this.writer.issue(target, parent, 'SCAN_INCOMPLETE', true, false, true);
      return undefined;
    }
  }
}
