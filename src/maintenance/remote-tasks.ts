// 维护遗留copy记录，按当前未知责任决定保留或放弃不可观察的task。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { operations } from '../database/operation-schema.js';
import {
  taskFact,
  taskInstance,
  safetyTracked,
  updateTaskFact,
} from '../database/task-records.js';
import type { TaskFact } from '../database/task-records.js';
import { AppConfig } from '../configuration/app-config.js';
import { Readiness } from '../coordination/readiness.js';
import { TaskResources } from '../coordination/task-resources.js';
import { OpenListTasks } from '../openlist/tasks.service.js';
import { aborted } from '../common/abort.js';
import { OpenListError } from '../openlist/errors.js';
import {
  cleanupTask,
  taskGone,
  taskTerminal,
} from '../openlist/task-protocol.js';

/** 只处理本服务标记的task，不触碰远程文件。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class RemoteTaskMaintenance {
  private readonly logger = new Logger(RemoteTaskMaintenance.name);
  /** 保存共享责任和协议依赖。
   * @param database 单写数据库。
   * @param config 进程当前设置。
   * @param readiness 停止闸门。
   * @param resources task owner与额度。
   * @param tasks task协议。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(Readiness) private readonly readiness: Readiness,
    @Inject(TaskResources) private readonly resources: TaskResources,
    @Inject(OpenListTasks) private readonly tasks: OpenListTasks,
  ) {}
  /** 按ID分页处理本轮责任，每个网络请求使用客户端API配额。
   * @param 不适用。
   * @returns 本轮结束或关机。
   * @throws Error 数据库/实现错误。
   */
  async cycle(): Promise<void> {
    let after = '';
    while (!this.readiness.stopping) {
      const rows = this.database.db
        .select({ id: operations.id })
        .from(operations)
        .where(
          and(
            eq(operations.remoteCleanupPending, true),
            gt(operations.id, after),
          ),
        )
        .orderBy(asc(operations.id))
        .limit(100)
        .all();
      if (!rows.length) return;
      for (const row of rows) {
        after = row.id;
        if (this.readiness.stopping) return;
        await this.one(row.id);
      }
    }
  }
  /** 取得tid owner并在每个异步响应后条件提交。
   * @param id 标记的原Operation。
   * @returns 当前行有界维护结束。
   * @throws Error 本地持久化失败。
   */
  async one(id: string): Promise<void> {
    const db = this.database.db;
    let fact = taskFact(db, id);
    if (
      !fact?.operation.remoteCleanupPending ||
      !fact.operation.openlistTaskId ||
      this.readiness.stopping
    )
      return;
    const tid = fact.operation.openlistTaskId;
    const release = this.resources.own(fact.operation.targetInstanceId, tid);
    if (!release) return;
    const settings = this.config.execution;
    const request = { settings, signal: this.readiness.shutdown.signal };
    try {
      const instance = taskInstance(db, fact.operation);
      const info = await this.tasks.info(instance, tid, request);
      if (this.readiness.stopping) return;
      if (
        !updateTaskFact(db, fact, info.state, false, settings.quarantineSeconds)
      )
        return;
      if (!taskTerminal(info.state)) {
        this.resources.hold(id, fact.operation.targetInstanceId);
        return;
      }
      this.resources.release(id);
      fact = taskFact(db, id);
      if (!fact?.operation.remoteCleanupPending) return;
      const outcome = await cleanupTask(
        this.tasks,
        instance,
        tid,
        request,
        settings,
        settings.retryMaxAttempts,
      );
      if (this.readiness.stopping) return;
      if (outcome.kind === 'observed') {
        if (
          updateTaskFact(
            db,
            fact,
            outcome.state,
            false,
            settings.quarantineSeconds,
          )
        )
          this.resources.hold(id, fact.operation.targetInstanceId);
      } else {
        this.clear(fact, outcome.kind === 'failed');
      }
    } catch (error) {
      if (!(error instanceof OpenListError) && !aborted(error, request.signal))
        throw error;
      if (this.readiness.stopping) return;
      if (!(error instanceof OpenListError)) throw error;
      if (fact && (taskGone(error) || !safetyTracked(fact)))
        this.clear(fact, !taskGone(error));
      else
        this.logger.warn('Task observation retained', {
          operationId: id,
          errorCode: error.code,
        });
    } finally {
      release();
    }
  }
  /** 清标志提交后才释放额度，变化中的resolution使提交失效。
   * @param fact 请求前事实。
   * @param abandoned 是否有界放弃。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  private clear(fact: TaskFact, abandoned: boolean): void {
    if (
      !updateTaskFact(
        this.database.db,
        fact,
        undefined,
        true,
        this.config.execution.quarantineSeconds,
      )
    )
      return;
    this.resources.release(fact.operation.id);
    if (abandoned)
      this.logger.warn('Task housekeeping abandoned', {
        operationId: fact.operation.id,
      });
  }
}
