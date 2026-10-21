// 按Run固定身份读取当前凭据、路径密码及可信目录视图。
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { instances } from '../database/schema.js';
import type { InstanceRecord } from '../database/schema.js';
import type { RunRecord, RunTargetRecord } from '../database/run-schema.js';
import type { KeysService } from '../security/keys.service.js';
import type { OpenListClient } from '../openlist/client.service.js';
import type { FileEntry, FileList } from '../openlist/protocol.js';
import { OpenListError } from '../openlist/errors.js';
import { globalPath } from '../openlist/paths.js';
import { resolveMount } from '../openlist/mounts.js';
import type { Storage } from '../openlist/mounts.js';
import { objectInput } from '../jobs/validation.js';
import type { PathSecrets } from '../jobs/job-types.js';

/** 分离账号绝对路径，不改变原始文件名。
 * @param path 规范化账号路径。
 * @returns 父目录及原名。
 * @throws 不适用。
 */
export function splitPath(path: string): { directory: string; name: string } {
  const index = path.lastIndexOf('/');
  return {
    directory: path.slice(0, index) || '/',
    name: path.slice(index + 1),
  };
}
/** 解密一个Run的独立路径密码副本。
 * @param keys 已校验密钥。
 * @param run 当前Run。
 * @returns 仅在内存使用的端点密码。
 * @throws Error 密文或结构损坏。
 */
export function runSecrets(keys: KeysService, run: RunRecord): PathSecrets {
  if (run.secretSnapshotEnc === null)
    return { sourcePassword: null, targetPasswords: {} };
  const value = objectInput(
    JSON.parse(
      keys.decrypt(run.secretSnapshotEnc, {
        table: 'runs',
        recordId: run.id,
        field: 'secret_snapshot_enc',
      }),
    ) as unknown,
    ['sourcePassword', 'targetPasswords'],
    'secretSnapshot',
  );
  if (value.sourcePassword !== null && typeof value.sourcePassword !== 'string')
    throw new Error('Invalid source password snapshot');
  if (
    !value.targetPasswords ||
    typeof value.targetPasswords !== 'object' ||
    Array.isArray(value.targetPasswords)
  )
    throw new Error('Invalid target password snapshot');
  const targetPasswords: Record<string, string | null> = {};
  for (const [id, password] of Object.entries(value.targetPasswords)) {
    if (password !== null && typeof password !== 'string')
      throw new Error('Invalid target password snapshot');
    targetPasswords[id] = password;
  }
  return { sourcePassword: value.sourcePassword, targetPasswords };
}
/** 当前Run的观察上下文；挂载映射按实例加载一次。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class ExecutionContext {
  private readonly mounts = new Map<string, Storage[]>();
  /** 保存固定配置和当前工作的期限。
   * @param db 数据库。
   * @param client 共享客户端。
   * @param run 固定Run。
   * @param secrets 本Run的路径密码。
   * @param signal 停止派发新工作的信号（取消、超时、关闭或恢复期限）。
   * @param cleanup 是否属于停止后的有界观察。
   * @param hard 已派发远端动作的收尾期限；停止后仍允许在宽限内取得响应或确认结果。
   * @param stopping 进程是否正在关闭；关闭时无结论的动作留给下次启动恢复。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    readonly db: BetterSQLite3Database,
    readonly client: OpenListClient,
    readonly run: RunRecord,
    readonly secrets: PathSecrets,
    readonly signal: AbortSignal,
    readonly cleanup = false,
    readonly hard: AbortSignal = signal,
    readonly stopping: () => boolean = notStopping,
  ) {}
  /** 组合当前凭据与固定身份，不读取可变Job配置。
   * @param id 实例ID。
   * @returns 内部连接记录。
   * @throws Error 实例或快照缺失。
   */
  instance(id: string): InstanceRecord {
    const current = this.db
      .select()
      .from(instances)
      .where(eq(instances.id, id))
      .get();
    const snapshot = this.run.config.instances[id];
    if (!current || !snapshot) throw new Error('Run instance missing');
    return { ...current, ...snapshot, ...snapshot.limits };
  }
  /** 固定网络设置和本生命周期信号。
   * @param 不适用。
   * @returns 客户端上下文。
   * @throws 不适用。
   */
  request() {
    return {
      signal: this.signal,
      settings: this.run.config.settings,
      cleanup: this.cleanup,
    };
  }
  /** 已派发远端动作的响应等待与结果确认：停止派发后仍在收尾期限内进行，不受进程关闭的普通中止影响。
   * @param signal 本次收尾期限；默认Run收尾期限，调用方可叠加文件级硬期限。
   * @returns 使用收尾期限的客户端上下文。
   * @throws 不适用。
   */
  inflight(signal: AbortSignal = this.hard) {
    return {
      signal,
      settings: this.run.config.settings,
      cleanup: true,
    };
  }
  /** 刷新并验证目录，可疑挂载或受保护非法后代不被解释为缺失。
   * @param target 本Run目标。
   * @param path 账号内目录。
   * @param inflight 已派发动作的确认/观察读取期限；省略表示提交前读取，使用停止派发信号。
   * @param passwordOverride 源元数据准备时使用源路径密码。
   * @returns 完整可用于前提判断的列表。
   * @throws OpenListError 不可读或挂载视图不可用；Error 本地失败。
   */
  async list(
    target: RunTargetRecord,
    path: string,
    inflight?: AbortSignal,
    passwordOverride?: string,
  ): Promise<FileList> {
    const options = inflight ? this.inflight(inflight) : this.request();
    const instance = this.instance(target.config.target.instanceId);
    if (instance.accountRole === 2 && !this.mounts.has(instance.id))
      this.mounts.set(
        instance.id,
        await this.client.storages(instance, options),
      );
    const list = await this.client.list(
      instance,
      path,
      passwordOverride ?? this.secrets.targetPasswords[target.targetId] ?? '',
      true,
      options,
    );
    const mounts = this.mounts.get(instance.id);
    if (mounts) {
      const resolution = resolveMount(
        mounts,
        globalPath(instance.accountBasePath ?? '/', path),
      );
      if (resolution.suspect || !resolution.storage)
        throw new OpenListError(
          'PRECONDITION_UNVERIFIED',
          'Untrusted mount view',
          null,
          null,
          0,
          undefined,
          false,
        );
    } else if (
      [...list.items, ...list.protectedEntries].some(
        /** 识别非管理员列表中的嵌套挂载风险。
         * @param entry 当前队列或目录条目。
         * @returns 是否出现挂载提示。
         * @throws 不适用。
         */
        (entry) => entry.mountDetails,
      )
    )
      throw new OpenListError(
        'PRECONDITION_UNVERIFIED',
        'Suspect directory view',
        null,
        null,
        0,
        undefined,
        false,
      );
    return list;
  }
  /** 通过完整父列表观察一个路径；缺失父分支可由新鲜祖先列表证明。
   * @param target 本Run目标。
   * @param path 账号内对象路径。
   * @param inflight 已派发动作的确认/观察读取期限；省略表示提交前读取，使用停止派发信号。
   * @returns 当前对象，或明确缺失的null。
   * @throws OpenListError 读取失败而无法证明缺失；Error 本地错误。
   */
  async entry(
    target: RunTargetRecord,
    path: string,
    inflight?: AbortSignal,
  ): Promise<FileEntry | null> {
    if (path === '/') {
      await this.list(target, '/', inflight);
      return {
        name: '',
        size: 0,
        isDir: true,
        modified: null,
        sign: '',
        mountDetails: false,
      };
    }
    const { directory, name } = splitPath(path);
    try {
      const list = await this.list(target, directory, inflight);
      return (
        list.items.find(
          /** 在完整父列表内按原名查找目标对象。
           * @param entry 当前队列或目录条目。
           * @returns 是否匹配。
           * @throws 不适用。
           */
          (entry) => entry.name === name,
        ) ?? null
      );
    } catch (error) {
      (inflight ?? this.signal).throwIfAborted();
      if (!(error instanceof OpenListError)) throw error;
      if (
        directory === '/' ||
        error.upstreamCode === 403 ||
        error.httpStatus === 403 ||
        error.code === 'AUTH_BLOCKED' ||
        error.code === 'PRECONDITION_UNVERIFIED'
      )
        throw error;
      const parent = await this.entry(target, directory, inflight);
      if (parent === null) return null;
      throw error;
    }
  }
}

/** 未显式提供生命周期时按正常运行处理。
 * @param 不适用。
 * @returns false。
 * @throws 不适用。
 */
function notStopping(): boolean {
  return false;
}
