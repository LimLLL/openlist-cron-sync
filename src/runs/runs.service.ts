// 原子接受运行并提供分页历史视图，不依赖 Jobs 或 Instances 模块。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { runs, runTargets, scanIssues } from '../database/run-schema.js';
import type { RunRecord } from '../database/run-schema.js';
import { operations } from '../database/operation-schema.js';
import { jobRecords, jobView } from '../database/job-records.js';
import { assertJobIdle } from '../database/responsibility.js';
import {
  validateEndpoints,
  instanceSnapshot,
} from '../jobs/endpoint-validation.js';
import { decryptJobSecrets } from '../jobs/job-secrets.js';
import { KeysService } from '../security/keys.service.js';
import { AppConfig } from '../configuration/app-config.js';
import { Readiness } from '../coordination/coordination.module.js';
import { ApiError } from '../common/errors.js';
import { emptyStats } from '../sync/stats.js';
import { RunDispatcher } from './run-dispatcher.service.js';
import { runView, targetView, operationView } from './views.js';
import type { RunConfig } from './run-types.js';
import type {
  TriggerRunDto,
  RunQueryDto,
  OperationQueryDto,
  PageQueryDto,
} from './input.dto.js';

/** Run 入口及查询服务。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);
  /** 保存依赖，所有请求共用同一个派发器。
   * @param database 数据库。
   * @param keys 密钥。
   * @param config 当前进程配置。
   * @param readiness 启动和关闭闸门。
   * @param dispatcher 扫描、执行与恢复派发器。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(KeysService) private readonly keys: KeysService,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(Readiness) private readonly readiness: Readiness,
    @Inject(RunDispatcher) private readonly dispatcher: RunDispatcher,
  ) {}
  /** 接受手动运行，事务内固定所有非秘密配置和独立密码快照。
   * @param jobId Job ID。
   * @param input 真实执行或预览参数。
   * @param scheduledAt cron理论触发UTC毫秒；省略为手动。
   * @returns 已持久化的 queued 公共视图。
   * @throws ApiError 不就绪、忙、队列满或配置错误；Error 数据库失败。
   */
  trigger(jobId: string, input: TriggerRunDto, scheduledAt?: number) {
    if (
      !this.readiness.ready ||
      !this.readiness.recovered ||
      this.readiness.stopping
    )
      throw new ApiError(503, 'NOT_READY', 'Run dispatcher is not ready');
    const db = this.database.db;
    const run = db.transaction(
      /** 在一个事务内确认 Job 空闲且队列未满，校验端点后写入固定配置快照、加密的路径密码快照及每目标 Run Target。
       * @param 不适用。
       * @returns 新建的 queued Run 记录。
       * @throws ApiError Job 不存在、JOB_BUSY、QUEUE_FULL 或端点校验失败；Error 解密、加密或数据库失败。
       */
      () => {
        const { row, targets } = jobRecords(db, jobId);
        if (scheduledAt !== undefined && (!row.enabled || row.cron === null))
          throw new ApiError(409, 'INVALID_STATE', 'Job cron is disabled');
        assertJobIdle(db, jobId);
        const queued =
          db
            .select({ n: count() })
            .from(runs)
            .where(eq(runs.status, 'queued'))
            .get()?.n ?? 0;
        if (queued >= this.config.maxQueuedRuns)
          throw new ApiError(503, 'QUEUE_FULL', 'Run queue is full');
        const job = jobView(row, targets);
        const records = validateEndpoints(db, job, true);
        const snapshots: RunConfig['instances'] = {};
        for (const [id, instance] of records)
          snapshots[id] = instanceSnapshot(instance);
        const config: RunConfig = {
          snapshotVersion: 1,
          job,
          instances: snapshots,
          settings: {
            ...this.config.execution,
            retryMaxAttempts:
              job.retryCount === null
                ? this.config.execution.retryMaxAttempts
                : job.retryCount + 1,
          },
        };
        const id = randomUUID();
        const now = Date.now();
        const secrets = decryptJobSecrets(this.keys, row, targets);
        const hasSecrets =
          secrets.sourcePassword !== null ||
          Object.values(secrets.targetPasswords).some(
            /** 检查目标路径密码是否已设置。
             * @param password 目标路径明文密码或 null。
             * @returns 是否需要写入秘密快照。
             * @throws 不适用。
             */
            (password) => password !== null,
          );
        db.insert(runs)
          .values({
            id,
            jobId,
            trigger: scheduledAt === undefined ? 'manual' : 'cron',
            scheduledAt: scheduledAt ?? null,
            dryRun: input.dryRun ?? false,
            confirmDeletes: input.confirmDeletes,
            status: 'queued',
            config,
            secretSnapshotEnc: hasSecrets
              ? this.keys.encrypt(JSON.stringify(secrets), {
                  table: 'runs',
                  recordId: id,
                  field: 'secret_snapshot_enc',
                })
              : null,
            stats: emptyStats(),
            createdAt: now,
            updatedAt: now,
            queueDeadlineAt: now + config.settings.queueTimeoutSeconds * 1000,
          })
          .run();
        for (const target of job.targets)
          db.insert(runTargets)
            .values({
              id: randomUUID(),
              runId: id,
              targetId: target.id,
              config: { target, instance: snapshots[target.instanceId] },
              stats: emptyStats(),
              blockReasons: [],
            })
            .run();
        return this.record(id);
      },
    );
    this.dispatcher.accept(run);
    this.logger.log('Run accepted', {
      jobId,
      runId: run.id,
      confirmDeletes: input.confirmDeletes,
    });
    return runView(run);
  }
  /** 请求取消；重复请求不重复远程abort。
   * @param id Run ID。
   * @returns 当前公共运行视图。
   * @throws ApiError 不存在；Error 数据库失败。
   */
  cancel(id: string) {
    return runView(this.dispatcher.cancel(id));
  }
  /** 读取运行记录，历史不依赖 Job 当前配置。
   * @param id Run ID。
   * @returns 持久化记录。
   * @throws ApiError 不存在；Error 数据库失败。
   */
  record(id: string): RunRecord {
    const row = this.database.db
      .select()
      .from(runs)
      .where(eq(runs.id, id))
      .get();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Run not found');
    return row;
  }
  /** 返回固定配置和每目标保护事实。
   * @param id Run ID。
   * @returns RunDetail。
   * @throws ApiError 不存在；Error 数据库失败。
   */
  get(id: string) {
    const row = this.record(id);
    const db = this.database.db;
    const targets = db
      .select()
      .from(runTargets)
      .where(eq(runTargets.runId, id))
      .all();
    targets.sort(
      /** 按快照中的目标 position 升序比较两个 Run Target。
       * @param a 左侧 Run Target 记录。
       * @param b 右侧 Run Target 记录。
       * @returns 负数、零或正数表示的排序关系。
       * @throws 不适用。
       */
      (a, b) => a.config.target.position - b.config.target.position,
    );
    return {
      ...runView(row),
      config: row.config,
      targets: targets.map(targetView),
      issueCount:
        db
          .select({ n: count() })
          .from(scanIssues)
          .where(eq(scanIssues.runId, id))
          .get()?.n ?? 0,
    };
  }
  /** 分页运行列表。
   * @param query 过滤和分页。
   * @returns Page RunView。
   * @throws ApiError 分页越界；Error 数据库失败。
   */
  list(query: RunQueryDto) {
    const db = this.database.db;
    const where = and(
      query.jobId === undefined ? undefined : eq(runs.jobId, query.jobId),
      query.status === undefined ? undefined : eq(runs.status, query.status),
      query.dryRun === undefined ? undefined : eq(runs.dryRun, query.dryRun),
    );
    return {
      items: db
        .select()
        .from(runs)
        .where(where)
        .orderBy(desc(runs.createdAt), desc(runs.id))
        .limit(query.pageSize)
        .offset(offset(query))
        .all()
        .map(runView),
      page: query.page,
      pageSize: query.pageSize,
      total: db.select({ n: count() }).from(runs).where(where).get()?.n ?? 0,
    };
  }
  /** 按 Run 内 seq 查询操作，不把完整计划加载内存。
   * @param id Run ID。
   * @param query 过滤和分页。
   * @returns Page OperationView。
   * @throws ApiError 不存在或分页错误；Error 数据库失败。
   */
  operations(id: string, query: OperationQueryDto) {
    this.record(id);
    const db = this.database.db;
    const where = and(
      eq(operations.runId, id),
      query.status === undefined
        ? undefined
        : eq(operations.status, query.status),
      query.action === undefined
        ? undefined
        : eq(operations.action, query.action),
      query.includeMaintenance
        ? undefined
        : isNull(operations.causedByOperationId),
    );
    return {
      items: db
        .select()
        .from(operations)
        .where(where)
        .orderBy(asc(operations.seq))
        .limit(query.pageSize)
        .offset(offset(query))
        .all()
        .map(operationView),
      page: query.page,
      pageSize: query.pageSize,
      total:
        db.select({ n: count() }).from(operations).where(where).get()?.n ?? 0,
    };
  }
  /** 分页诊断，包括不降级的提示和警告。
   * @param id Run ID。
   * @param query 分页。
   * @returns Page ScanIssueView。
   * @throws ApiError 不存在或分页错误；Error 数据库失败。
   */
  issues(id: string, query: PageQueryDto) {
    this.record(id);
    const db = this.database.db;
    const where = eq(scanIssues.runId, id);
    return {
      items: db
        .select()
        .from(scanIssues)
        .where(where)
        .orderBy(desc(scanIssues.createdAt), desc(scanIssues.id))
        .limit(query.pageSize)
        .offset(offset(query))
        .all()
        .map(
          /** 将诊断记录的创建毫秒转换为 API 时间。
           * @param row 当前页诊断记录。
           * @returns 字段不变、createdAt 为 UTC 字符串的诊断视图。
           * @throws RangeError 时间不合法。
           */
          (row) => ({
            ...row,
            createdAt: new Date(row.createdAt).toISOString(),
          }),
        ),
      page: query.page,
      pageSize: query.pageSize,
      total:
        db.select({ n: count() }).from(scanIssues).where(where).get()?.n ?? 0,
    };
  }
}
/** 检查 offset 的整数安全性。
 * @param query 已验证分页。
 * @returns offset。
 * @throws ApiError 计算溢出。
 */
function offset(query: PageQueryDto): number {
  const value = (query.page - 1) * query.pageSize;
  if (!Number.isSafeInteger(value))
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Pagination offset is too large',
    );
  return value;
}
