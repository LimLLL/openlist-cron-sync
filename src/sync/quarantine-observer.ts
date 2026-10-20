// 把隔离所需的强制观察接入扫描及提交，读取使用新Run自己的身份和密码。
import { Logger } from '@nestjs/common';
import type { Quarantine } from '../coordination/quarantine.js';
import type { RunTargetRecord } from '../database/run-schema.js';
import { OpenListError } from '../openlist/errors.js';
import type { ExecutionContext } from './execution-context.js';

/** 一个Run的隔离观察器，不保存全计划或历史unknown集合。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class QuarantineObserver {
  private readonly logger = new Logger(QuarantineObserver.name);
  /** 绑定当前Run及分页责任读取。
   * @param context 当前Run的观察能力。
   * @param quarantine 叶子隔离存取。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    readonly context: ExecutionContext,
    readonly quarantine: Quarantine,
  ) {}
  /** 判断普通目录扫描是否必须改为强制刷新。
   * @param target 当前目标。
   * @param directory 即将列举的目录。
   * @returns 是否存在待重新观察责任。
   * @throws Error 数据库失败。
   */
  refresh(target: RunTargetRecord, directory: string): boolean {
    if (this.context.run.dryRun) return false;
    for (const fact of this.quarantine.matching(
      target.config.instance,
      directory,
      'delete',
    ))
      if (!this.quarantine.active(fact.operation)) return true;
    return false;
  }
  /** 检查候选写入；active只跳过，到期则新鲜观察全部相关父路径。
   * @param target 当前目标。
   * @param path 候选写路径。
   * @param action 候选动作。
   * @returns 是否允许按当前计划继续。
   * @throws Error 数据库或本地失败；取消向上传播。
   */
  async allows(
    target: RunTargetRecord,
    path: string,
    action: 'mkdir' | 'create' | 'delete',
  ): Promise<boolean> {
    for (const fact of this.quarantine.matching(
      target.config.instance,
      path,
      action,
    )) {
      if (this.quarantine.active(fact.operation)) return false;
      if (this.context.run.dryRun) continue;
      if (fact.localPath === null) return false;
      try {
        const entry = await this.context.entry(target, fact.localPath);
        this.quarantine.reobserved(fact.operation.id, this.context.run.id);
        if (
          fact.operation.targetInstanceId === target.config.instance.id &&
          ((fact.operation.action === 'delete' && entry === null) ||
            (fact.operation.action === 'mkdir' && entry?.isDir))
        )
          this.quarantine.resolve(
            fact.operation.id,
            this.context.run.id,
            'observed',
          );
      } catch (error) {
        this.context.signal.throwIfAborted();
        if (!(error instanceof OpenListError)) throw error;
        this.logger.warn('Quarantine observation blocked', {
          runId: this.context.run.id,
          operationId: fact.operation.id,
          errorCode: error.code,
        });
        return false;
      }
    }
    return true;
  }
  /** 在当前源与新鲜目标大小相同后解决同身份create未知。
   * @param target 当前目标。
   * @param path 文件账号路径。
   * @param size 当前源的已知大小。
   * @returns 观察完成。
   * @throws Error 本地失败或取消。
   */
  async unchanged(
    target: RunTargetRecord,
    path: string,
    size: number,
  ): Promise<void> {
    if (this.context.run.dryRun) return;
    for (const fact of this.quarantine.matching(
      target.config.instance,
      path,
      'create',
    )) {
      if (
        fact.operation.targetInstanceId !== target.config.instance.id ||
        fact.operation.targetPath !== path ||
        fact.operation.action !== 'create' ||
        this.quarantine.active(fact.operation)
      )
        continue;
      if (!(await this.allows(target, path, 'create'))) return;
      try {
        const entry = await this.context.entry(target, path);
        if (entry && !entry.isDir && entry.size === size)
          this.quarantine.resolve(
            fact.operation.id,
            this.context.run.id,
            'observed',
          );
      } catch (error) {
        this.context.signal.throwIfAborted();
        if (!(error instanceof OpenListError)) throw error;
        this.logger.warn('Quarantine comparison unavailable', {
          operationId: fact.operation.id,
          errorCode: error.code,
        });
      }
    }
  }
}
