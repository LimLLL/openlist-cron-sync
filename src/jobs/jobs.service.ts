// 在短事务内合并 Job 配置、归档目标，并独立加密路径密码。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { jobs, jobTargets } from '../database/job-schema.js';
import { jobRecords, jobView } from '../database/job-records.js';
import { assertJobIdle } from '../database/responsibility.js';
import { KeysService } from '../security/keys.service.js';
import { decryptJobSecrets } from './job-secrets.js';
import { mergeJob } from './validation.js';
import { validateEndpoints } from './endpoint-validation.js';
import type { Job, PathSecrets } from './job-types.js';
import { SchedulingService } from '../scheduling/scheduling.service.js';
import { validateSchedule } from '../scheduling/cron-time.js';
import { ApiError } from '../common/errors.js';

/** Job 配置服务；事务提交后通知 Scheduling 更新 cron，不调用远程文件 API。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  /** 保存数据库、加密及提交后的调度依赖。
   * @param database 数据库。
   * @param keys 已通过启动校验的密钥。
   * @param scheduling 提交后更新cron注册。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(KeysService) private readonly keys: KeysService,
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
  ) {}
  /** 获取公共 Job。
   * @param id Job ID。
   * @returns 公共配置。
   * @throws ApiError 不存在；Error 数据库失败。
   */
  get(id: string): Job {
    const { row, targets } = jobRecords(this.database.db, id);
    return jobView(row, targets);
  }
  /** 分页查询配置，包括显式请求的归档项。
   * @param page 页号。
   * @param pageSize 页大小。
   * @param includeArchived 是否显示归档。
   * @returns 分页响应。
   * @throws ApiError offset 溢出；Error 数据库失败。
   */
  list(
    page: number,
    pageSize: number,
    includeArchived: boolean,
  ): { items: Job[]; page: number; pageSize: number; total: number } {
    const db = this.database.db;
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset))
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Pagination offset is too large',
      );
    const where = includeArchived ? undefined : isNull(jobs.archivedAt);
    const rows = db
      .select()
      .from(jobs)
      .where(where)
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(pageSize)
      .offset(offset)
      .all();
    const items = rows.map(
      /** 读取 Job 的成员目标并投影公共配置；归档 Job 的成员即归档时的最终目标集合。
       * @param row 当前页 Job 记录。
       * @returns 公共 Job。
       * @throws RangeError 时间不合法；Error 数据库失败。
       */
      (row) =>
        jobView(
          row,
          db
            .select()
            .from(jobTargets)
            .where(
              and(eq(jobTargets.jobId, row.id), isNull(jobTargets.archivedAt)),
            )
            .orderBy(asc(jobTargets.position))
            .all(),
        ),
    );
    return {
      items,
      page,
      pageSize,
      total:
        db.select({ value: count() }).from(jobs).where(where).get()?.value ?? 0,
    };
  }
  /** 创建配置；所有校验和写入同事务。
   * @param input 请求体。
   * @returns 新 Job。
   * @throws ApiError 校验失败；Error 加密或数据库失败。
   */
  create(input: unknown): Job {
    const result = this.database.db.transaction(
      /** 在一个事务内合并默认值、校验端点并写入新 Job 与目标。
       * @param 不适用。
       * @returns 新 Job 的公共配置。
       * @throws ApiError 配置或端点校验失败；Error 加密或数据库失败。
       */
      () => {
        const merged = mergeJob(input);
        validateEndpoints(this.database.db, merged.job, merged.job.enabled);
        this.save(merged.job, merged.secrets, false);
        return this.get(merged.job.id);
      },
    );
    this.scheduling.sync(result);
    this.logger.log('Job created', { jobId: result.id });
    return result;
  }
  /** 合并补丁，活动 Run 时拒绝。
   * @param id Job ID。
   * @param input 请求体。
   * @returns 更新后的公共配置。
   * @throws ApiError JOB_BUSY 或验证失败；Error 加密或数据库失败。
   */
  patch(id: string, input: unknown): Job {
    const result = this.database.db.transaction(
      /** 在一个事务内确认 Job 空闲，合并补丁与原路径密码后校验端点并覆盖写入。
       * @param 不适用。
       * @returns 更新后的公共配置。
       * @throws ApiError 不存在、JOB_BUSY 或校验失败；Error 解密、加密或数据库失败。
       */
      () => {
        const { row, targets } = jobRecords(this.database.db, id);
        assertJobIdle(this.database.db, id);
        const merged = mergeJob(
          input,
          jobView(row, targets),
          decryptJobSecrets(this.keys, row, targets),
        );
        validateEndpoints(this.database.db, merged.job, merged.job.enabled);
        this.save(merged.job, merged.secrets, true);
        return this.get(id);
      },
    );
    this.scheduling.sync(result);
    this.logger.log('Job updated', { jobId: id });
    return result;
  }
  /** 逻辑归档 Job；成员目标保持不变，作为最终配置随父 Job 一起失效。
   * @param id Job ID。
   * @returns 不适用。
   * @throws ApiError JOB_BUSY 或不存在；Error 数据库失败。
   */
  archive(id: string): void {
    this.database.db.transaction(
      /** 在一个事务内校验 Job 存在且空闲，再只归档 Job 本身。
       * @param 不适用。
       * @returns 不适用。
       * @throws ApiError 不存在或 JOB_BUSY；Error 数据库失败。
       */
      () => {
        jobRecords(this.database.db, id);
        assertJobIdle(this.database.db, id);
        const now = Date.now();
        // 目标的 archived_at 只表示“被配置更新移出成员集合”，不复制父 Job 的归档状态，避免同毫秒移除与归档无法区分。
        this.database.db
          .update(jobs)
          .set({ archivedAt: now, updatedAt: now })
          .where(eq(jobs.id, id))
          .run();
      },
    );
    this.scheduling.remove(id);
    this.logger.log('Job archived', { jobId: id });
  }
  /** 仅切换enabled，不改写目标、密码或活动Run快照。
   * @param id 未归档Job。
   * @param enabled 新启用值。
   * @returns 公共Job。
   * @throws ApiError 配置不可启用；Error 数据库失败。
   */
  setEnabled(id: string, enabled: boolean): Job {
    const result = this.database.db.transaction(
      /** 启用复用保存校验，disable不要求Job空闲。
       * @param 不适用。
       * @returns 提交后的配置。
       * @throws ApiError 校验失败；Error 数据库失败。
       */
      () => {
        const job = this.get(id);
        if (enabled) {
          validateSchedule(job.cron, job.timezone);
          validateEndpoints(this.database.db, job, true);
        }
        if (job.enabled !== enabled)
          this.database.db
            .update(jobs)
            .set({ enabled, updatedAt: Date.now() })
            .where(eq(jobs.id, id))
            .run();
        return this.get(id);
      },
    );
    this.scheduling.sync(result);
    this.logger.log('Job scheduling changed', { jobId: id, enabled });
    return result;
  }
  /** 返回库搜索范围内的未来UTC前缀。
   * @param id 未归档Job。
   * @param count 最大结果数。
   * @returns 时区及未来时间；disabled/manual-only为空。
   * @throws ApiError Job不存在；Error 数据库或非预期cron计算失败。
   */
  nextFireTimes(id: string, count: number) {
    return this.scheduling.next(this.get(id), count);
  }
  /** 持久化合并值；事务内先把全部成员移出成员集合以安全交换 position，再恢复保留成员，只有被移除的目标留下 archived_at。
   * @param job 完整配置。
   * @param secrets 路径密码。
   * @param update 是否更新现有 Job。
   * @returns 不适用。
   * @throws Error 数据库或加密失败。
   */
  private save(job: Job, secrets: PathSecrets, update: boolean): void {
    const db = this.database.db;
    const now = Date.parse(job.updatedAt);
    const row = {
      id: job.id,
      name: job.name,
      enabled: job.enabled,
      sourceInstanceId: job.source.instanceId,
      sourcePath: job.source.path,
      sourceDownloadConcurrency: job.sourceDownloadConcurrency,
      sourcePasswordEnc: encryptPathPassword(
        this.keys,
        secrets.sourcePassword,
        'jobs',
        job.id,
        'source_password_enc',
      ),
      sourceRefresh: job.source.refresh,
      cron: job.cron,
      timezone: job.timezone,
      includeGlobs: job.filters.include,
      excludeGlobs: job.filters.exclude,
      minSizeBytes: job.filters.minSizeBytes,
      maxSizeBytes: job.filters.maxSizeBytes,
      allowEmptySource: job.allowEmptySource,
      syncEmptyDirs: job.syncEmptyDirs,
      retryCount: job.retryCount,
      relayBandwidthLimit: job.relayBandwidthLimit,
      timeoutSeconds: job.timeoutSeconds,
      createdAt: Date.parse(job.createdAt),
      updatedAt: now,
    };
    if (update) {
      db.update(jobs).set(row).where(eq(jobs.id, job.id)).run();
      db.update(jobTargets)
        .set({ archivedAt: now, updatedAt: now })
        .where(and(eq(jobTargets.jobId, job.id), isNull(jobTargets.archivedAt)))
        .run();
    } else db.insert(jobs).values(row).run();
    for (const target of job.targets) {
      const values = {
        id: target.id,
        jobId: job.id,
        instanceId: target.instanceId,
        path: target.path,
        passwordEnc: encryptPathPassword(
          this.keys,
          secrets.targetPasswords[target.id] ?? null,
          'job_targets',
          target.id,
          'password_enc',
        ),
        position: target.position,
        mode: target.mode,
        createMode: target.createMode,
        concurrentFiles: target.concurrentFiles,
        chunkConcurrency: target.chunkConcurrency,
        refresh: target.refresh,
        deleteLimitsEnabled: target.deleteLimits.enabled,
        maxDeleteCount: target.deleteLimits.maxCount,
        maxDeletePercent: target.deleteLimits.maxPercent,
        archivedAt: null,
        updatedAt: now,
      };
      const exists = db
        .select({ id: jobTargets.id })
        .from(jobTargets)
        .where(eq(jobTargets.id, target.id))
        .get();
      if (exists)
        db.update(jobTargets)
          .set(values)
          .where(eq(jobTargets.id, target.id))
          .run();
      else
        db.insert(jobTargets)
          .values({ ...values, createdAt: now })
          .run();
    }
  }
}
/** 加密一个路径密码，空字符串与 null 不混淆。
 * @param keys 密钥服务。
 * @param value 明文或 null。
 * @param table 表名。
 * @param recordId 记录 ID。
 * @param field 列名。
 * @returns 独立 AAD 的密文或 null。
 * @throws Error 加密失败。
 */
function encryptPathPassword(
  keys: KeysService,
  value: string | null,
  table: string,
  recordId: string,
  field: string,
): string | null {
  return value === null
    ? null
    : keys.encrypt(value, { table, recordId, field });
}
