// 动态管理Job cron；理论发生时刻与实际回调时间分离，所有触发进入Runs。
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { jobs } from '../database/job-schema.js';
import { jobRecords, jobView } from '../database/job-records.js';
import type { Job } from '../jobs/job-types.js';
import { RunsService } from '../runs/runs.service.js';
import { Readiness } from '../coordination/readiness.js';
import { FatalError } from '../coordination/fatal-error.js';
import { ApiError } from '../common/errors.js';
import { nextFireTimes, validateSchedule } from './cron-time.js';

/** 单个可被身份检查废弃的注册。 */
interface Registration {
  /** 固定调度字段。 */ expression: string;
  /** IANA时区。 */ timezone: string;
  /** 上次挂起的理论时刻。 */ scheduledAt: number;
  /** 合并同次timer的同步重复回调。 */ delivering: boolean;
  /** 固定库timer。 */ cron: CronJob;
}
/** 只负责注册，不拥有队列或Run状态。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class SchedulingService implements OnModuleInit, OnModuleDestroy {
  private readonly registrations = new Map<string, Registration>();
  private readonly logger = new Logger(SchedulingService.name);
  private detach?: () => void;
  /** 保存单向依赖。
   * @param database 配置读取。
   * @param registry Nest动态注册表。
   * @param runs 统一触发服务。
   * @param readiness 初始化及停止信号。
   * @param fatal 后台失败出口。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SchedulerRegistry) private readonly registry: SchedulerRegistry,
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(Readiness) private readonly readiness: Readiness,
    @Inject(FatalError) private readonly fatal: FatalError,
  ) {}
  /** 注册监听，启动仅发生在恢复重建及HTTP监听之后。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  onModuleInit(): void {
    this.detach = this.readiness.whenReady(this.start.bind(this));
    this.readiness.shutdown.signal.addEventListener('abort', this.stop, {
      once: true,
    });
  }
  /** 从权威配置恢复全部有效注册，不补跑过去时刻。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用；失败进入fatal出口。
   */
  private start(): void {
    try {
      const rows = this.database.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.enabled, true),
            isNull(jobs.archivedAt),
            isNotNull(jobs.cron),
          ),
        )
        .all();
      for (const row of rows) {
        const records = jobRecords(this.database.db, row.id);
        const job = jobView(records.row, records.targets);
        // 早期版本可能保存过可解析但无下一时刻的表达式；跳过该Job并记录，不让每次启动都失败。
        try {
          validateSchedule(job.cron, job.timezone);
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          this.logger.warn('Cron registration skipped', {
            jobId: job.id,
            reason: error.code,
          });
          continue;
        }
        this.sync(job);
      }
    } catch (error) {
      this.fatal.fail(error);
    }
  }
  /** 提交后按实际调度字段替换，意外失败不补偿数据库。
   * @param job 已提交Job。
   * @returns 不适用。
   * @throws Error 注册失败，同时安排进程退出。
   */
  sync(job: Job): void {
    if (!this.readiness.ready || this.readiness.stopping) return;
    try {
      if (!job.enabled || job.cron === null || job.archivedAt !== null) {
        this.remove(job.id);
        return;
      }
      const old = this.registrations.get(job.id);
      if (old?.expression === job.cron && old.timezone === job.timezone) return;
      const cron = CronJob.from({
        cronTime: job.cron,
        timeZone: job.timezone,
        start: false,
        errorHandler: this.fatal.fail.bind(this.fatal),
        /** 仅当前注册可触发；业务异常不交scheduler吞没。
         * @param 不适用。
         * @returns 不适用。
         * @throws 不适用；意外失败进入fatal。
         */
        onTick: () => this.tick(job.id, registration),
      });
      const registration: Registration = {
        expression: job.cron,
        timezone: job.timezone,
        cron,
        scheduledAt: cron.nextDate().toMillis(),
        delivering: false,
      };
      this.remove(job.id);
      this.registry.addCronJob(job.id, cron);
      this.registrations.set(job.id, registration);
      cron.start();
    } catch (error) {
      this.fatal.fail(error);
      throw error;
    }
  }
  /** 合并库在重挂timer时的同步重复，并保存原理论发生时刻。
   * @param id Job ID。
   * @param registration 捕获的注册身份。
   * @returns 不适用。
   * @throws 不适用；未知异常fatal。
   */
  private tick(id: string, registration: Registration): void {
    if (this.registrations.get(id) !== registration || registration.delivering)
      return;
    registration.delivering = true;
    queueMicrotask(
      /** 下一轮timer允许新的触发，不以Run完成情况做隐藏去重。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      () => {
        registration.delivering = false;
      },
    );
    const scheduledAt = registration.scheduledAt;
    try {
      registration.scheduledAt = registration.cron.nextDate().toMillis();
      this.runs.trigger(
        id,
        { dryRun: false, confirmDeletes: false },
        scheduledAt,
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        [
          'NOT_READY',
          'JOB_BUSY',
          'QUEUE_FULL',
          'NOT_FOUND',
          'INVALID_STATE',
          'VALIDATION_ERROR',
          'PATH_OVERLAP',
          'INVALID_CRON',
        ].includes(error.code)
      )
        this.logger.log('Cron skipped', {
          jobId: id,
          scheduledAt,
          reason: error.code,
        });
      else this.fatal.fail(error);
    }
  }
  /** 停止并移除指定注册。
   * @param id Job ID。
   * @returns 不适用。
   * @throws Error 注册表错误，同时安排退出。
   */
  remove(id: string): void {
    const current = this.registrations.get(id);
    if (!current) return;
    this.registrations.delete(id);
    try {
      current.cron.stop();
      this.registry.deleteCronJob(id);
    } catch (error) {
      this.fatal.fail(error);
      throw error;
    }
  }
  /** 只计算预期时刻，不建立timer。
   * @param job 未归档Job。
   * @param count 最大数量。
   * @returns 时区及UTC前缀。
   * @throws Error 非预期计算错误。
   */
  next(job: Job, count: number) {
    return {
      timezone: job.timezone,
      times:
        job.enabled && job.cron
          ? nextFireTimes(job.cron, job.timezone, count)
          : [],
    };
  }
  /** 关闭开始立即停止timer，废弃全部回调身份。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  private readonly stop = (): void => {
    for (const registration of this.registrations.values())
      registration.cron.stop();
    this.registrations.clear();
  };
  /** 释放监听及timer，不依赖Nest scheduler的较晚停止钩子。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  onModuleDestroy(): void {
    this.readiness.beginShutdown();
    this.stop();
    this.detach?.();
  }
}
