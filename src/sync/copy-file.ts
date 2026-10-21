// 提供server_copy源元数据前提及单文件提交，删除链仍由FileCoordinator拥有。
import type { OperationRecord } from '../database/operation-schema.js';
import type { RunTargetRecord } from '../database/run-schema.js';
import { OpenListError } from '../openlist/errors.js';
import { splitPath } from './execution-context.js';
import type { ExecutionContext } from './execution-context.js';
import type { OperationStore } from './operation-store.js';
import type { CopyTracker } from './copy-tracker.js';

/** 具体copy创建能力，不另建执行器。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class CopyFile {
  /** 保存当前文件工作流依赖。
   * @param context 固定Run身份与期限。
   * @param store Operation持久化。
   * @param tracker 已知task跟踪。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    private readonly context: ExecutionContext,
    private readonly store: OperationStore,
    private readonly tracker: CopyTracker,
  ) {}
  /** 删除旧文件或部分目标前，要求完整新鲜source元数据与计划相符。
   * @param target 当前目标，用于共享可信列表验证。
   * @param op 待create操作。
   * @returns 源前提成立。
   * @throws OpenListError 源变化/读取失败；Error 计划损坏。
   */
  async source(target: RunTargetRecord, op: OperationRecord): Promise<void> {
    if (!op.sourcePath || !op.sourceInstanceId)
      throw new Error('Copy source missing');
    const { directory, name } = splitPath(op.sourcePath);
    const snapshot = this.context.run.config.instances[op.sourceInstanceId];
    const sourceTarget: RunTargetRecord = {
      ...target,
      config: {
        instance: snapshot,
        target: { ...target.config.target, instanceId: op.sourceInstanceId },
      },
    };
    const list = await this.context.list(
      sourceTarget,
      directory,
      undefined,
      this.context.secrets.sourcePassword ?? '',
    );
    if (list.warnings.length || list.protectedEntries.length)
      throw new OpenListError(
        'PRECONDITION_UNVERIFIED',
        'Untrusted source metadata',
        null,
        null,
        0,
        undefined,
        false,
      );
    const entry = list.items.find(
      /** 仅按原始名称核对源，不建立内容快照。
       * @param item 源目录条目。
       * @returns 是否原名相同。
       * @throws 不适用。
       */
      (item) => item.name === name,
    );
    if (!entry || entry.isDir || entry.size !== op.expectedSourceSize)
      throw new OpenListError(
        'SOURCE_CHANGED',
        'Source metadata changed',
        null,
        null,
        0,
        undefined,
        false,
      );
  }
  /** 发送单名称copy；明确无task成功，有task先持久化再跟踪。
   * @param op pending create。
   * @returns 已收敛或关机保留的操作。
   * @throws OpenListError 请求结果需观察；Error 本地错误。
   */
  async submit(op: OperationRecord): Promise<OperationRecord> {
    if (!op.sourcePath) throw new Error('Copy source missing');
    const source = splitPath(op.sourcePath);
    const destination = splitPath(op.targetPath);
    if (source.name !== destination.name) throw new Error('Copy name mismatch');
    const tasks = await this.tracker.tasks.copy(
      this.context.instance(op.targetInstanceId),
      source.directory,
      destination.directory,
      source.name,
      {
        ...this.context.inflight(),
        /** 实际发送前保存submitting并复核停止信号。
         * @param 不适用。
         * @returns 不适用。
         * @throws Error 数据库失败或停止。
         */
        beforeDispatch: () => this.store.submitting(op.id, this.context.signal),
      },
    );
    if (tasks.length > 1)
      throw new OpenListError(
        'UPSTREAM_PROTOCOL_ERROR',
        'Multiple tasks for one copy',
        null,
        null,
        0,
        undefined,
        true,
      );
    if (!tasks.length) {
      this.store.end(op.id, { status: 'succeeded' });
      return this.store.get(op.id);
    }
    this.tracker.submitted(op.id, tasks[0]);
    return this.tracker.track(this.context, this.store.get(op.id));
  }
}
