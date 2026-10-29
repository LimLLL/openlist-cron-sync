// 有界维护遗留 copy 任务记录，未知历史不延长删除责任。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { operationAttempts } from '../database/operation-schema.js';
import {
  taskFact,
  taskInstance,
  updateTaskFact,
} from '../database/task-records.js';
import type { ExecutionRecord } from '../database/operation-schema.js';
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
  /** 按ID分页处理本轮责任，任务观察与清理不使用扫描间隔。
   * @param 不适用。
   * @returns 本轮结束或关机。
   * @throws Error 数据库/实现错误。
   */
  async cycle(): Promise<void> {
    let after = '';
    while (!this.readiness.stopping) {
      const rows = this.database.db
        .select({ id: operationAttempts.id })
        .from(operationAttempts)
        .where(
          and(
            eq(operationAttempts.remoteCleanupPending, true),
            gt(operationAttempts.id, after),
          ),
        )
        .orderBy(asc(operationAttempts.id))
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
      !fact?.remoteCleanupPending ||
      !fact.openlistTaskId ||
      this.readiness.stopping
    )
      return;
    const tid = fact.openlistTaskId;
    const release = this.resources.own(fact.targetInstanceId, tid);
    if (!release) return;
    const settings = this.config.execution;
    const request = { settings, signal: this.readiness.shutdown.signal };
    try {
      const instance = taskInstance(db, fact);
      const info = await this.tasks.info(instance, tid, request);
      if (this.readiness.stopping) return;
      if (!updateTaskFact(db, fact, info.state, false)) return;
      if (!taskTerminal(info.state)) {
        this.resources.hold(id, fact.runTargetId);
        return;
      }
      this.resources.release(id);
      fact = taskFact(db, id);
      if (!fact?.remoteCleanupPending) return;
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
        if (updateTaskFact(db, fact, outcome.state, false))
          this.resources.hold(id, fact.runTargetId);
      } else {
        this.clear(fact, outcome.kind === 'failed');
      }
    } catch (error) {
      if (!(error instanceof OpenListError) && !aborted(error, request.signal))
        throw error;
      if (this.readiness.stopping) return;
      if (!(error instanceof OpenListError)) throw error;
      if (fact) this.clear(fact, !taskGone(error));
    } finally {
      release();
    }
  }
  /** 清标志提交后才释放额度，变化中的远程事实使提交失效。
   * @param fact 请求前事实。
   * @param abandoned 是否有界放弃。
   * @returns 不适用。
   * @throws Error 数据库失败。
   */
  private clear(fact: ExecutionRecord, abandoned: boolean): void {
    if (!updateTaskFact(this.database.db, fact, undefined, true)) return;
    this.resources.release(fact.id);
    if (abandoned)
      this.logger.warn('Task housekeeping abandoned', {
        attemptId: fact.id,
      });
  }
}
