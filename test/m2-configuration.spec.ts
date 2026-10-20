// 验证完整运行参数映射、SQLite约束和新增生产密文列的启动校验。
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import { AppConfig } from '../src/configuration/app-config.js';
import { executionSettings } from '../src/configuration/execution-settings.js';
import { DatabaseService } from '../src/database/database.service.js';
import {
  instances,
  jobs,
  jobTargets,
  runs,
  operations,
  operationDependencies,
} from '../src/database/schema.js';
import { KeysService } from '../src/security/keys.service.js';
import { initializeApplication } from '../src/http-setup.js';
import { constructApplication, environmentFor } from './helpers.js';
import { m2Fixture, preview, plan } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';

/** 覆盖执行参数映射与校验、SQLite 约束，以及新增生产密文列的启动密钥校验。
 * @param 不适用。
 * @returns 不适用。
 * @throws Error 断言失败。
 */
describe('M2 configuration and persistence', () => {
  let f: M2Fixture;
  afterEach(
    /** 关闭本用例创建的夹具。
     * @param 不适用。
     * @returns 完成 Promise。
     * @throws Error 清理失败。
     */
    async () => {
      if (f) await f.close();
    },
  );
  it.each([
    ['QUEUE_TIMEOUT_SECONDS', '59'],
    ['OPENLIST_TASK_POLL_MS', '499'],
    ['DELETE_CONFIRM_TIMEOUT_SECONDS', '4'],
    ['DELETE_CONFIRM_INTERVAL_MS', '499'],
    ['RELAY_IDLE_TIMEOUT_SECONDS', '4'],
    ['RELAY_TOTAL_TIMEOUT_SECONDS', '59'],
    ['QUARANTINE_SECONDS', '2099'],
    ['RECOVERY_TIMEOUT_SECONDS', '9'],
    ['CANCEL_GRACE_SECONDS', '0'],
    ['SCAN_MAX_DEPTH', '0'],
    ['SCAN_MAX_DIRECTORY_ENTRIES', '0'],
    ['MAX_OPERATIONS_PER_RUN', '0'],
    ['MAX_SCAN_ISSUES_PER_RUN', '0'],
    ['PLAN_BATCH_SIZE', '5001'],
  ])(
    'validates complete snapshot setting %s now',
    /** 快照执行参数越界时立即以 Invalid configuration 拒绝。
     * @param name 环境变量名。
     * @param value 越界取值。
     * @returns 不适用。
     * @throws Error 断言失败。
     */
    (name, value) => {
      expect(
        /** 只用一个越界变量解析执行参数。
         * @param 不适用。
         * @returns 不适用。
         * @throws Error 预期的 Invalid configuration。
         */
        () => executionSettings({ [name]: value }),
      ).toThrow(`Invalid configuration: ${name}`);
    },
  );
  /** 读取全部固定映射字段并落到安全整数默认值，尚未使用的未来变量即使非法也不影响解析。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('reads all fixed mapping fields while leaving other future variables untouched', () => {
    const config = new AppConfig(
      new ConfigService({
        environment: environmentFor('/tmp/m2-settings', {
          RUN_RETENTION_DAYS: 'invalid',
          NOTIFICATION_TIMEOUT_SECONDS: 'invalid',
        }),
      }),
    );
    expect(Object.values(config.execution).every(Number.isSafeInteger)).toBe(
      true,
    );
    expect(config.execution).toMatchObject({
      taskPollMs: 3000,
      quarantineSeconds: 86400,
      relayTotalTimeoutSeconds: 21600,
      deleteConfirmTimeoutSeconds: 60,
    });
  });
  /** SQLite 强制外键、每个 Job 至多一个活动 Run、操作 method 取值和依赖自引用检查。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('enforces foreign keys, active Job uniqueness, operation method and dependency checks in SQLite', async () => {
    f = await m2Fixture();
    const job = f.job();
    const run = await preview(f, job);
    const op = plan(f, run.id)[0];
    const db = f.app.get(DatabaseService).db;
    expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    expect(
      /** 把操作 method 改为不允许的取值。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期的 CHECK 约束失败。
       */
      () =>
        db
          .update(operations)
          .set({ method: 'remove' })
          .where(eq(operations.id, op.id))
          .run(),
    ).toThrow();
    expect(
      /** 插入依赖自身的操作依赖。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期的 CHECK 约束失败。
       */
      () =>
        db
          .insert(operationDependencies)
          .values({ operationId: op.id, dependsOnId: op.id })
          .run(),
    ).toThrow();
    expect(
      /** 把 Job 源实例改为不存在的 ID。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期的外键约束失败。
       */
      () =>
        db
          .update(jobs)
          .set({ sourceInstanceId: randomUUID() })
          .where(eq(jobs.id, job.id))
          .run(),
    ).toThrow();
    const record = f.runs().record(run.id);
    db.insert(runs)
      .values({ ...record, id: randomUUID(), status: 'queued', endedAt: null })
      .run();
    expect(
      /** 为同一 Job 插入第二个活动 Run。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期的唯一约束失败。
       */
      () =>
        db
          .insert(runs)
          .values({
            ...record,
            id: randomUUID(),
            status: 'queued',
            endedAt: null,
          })
          .run(),
    ).toThrow();
  });
  /** 只要该密文列仍有数据，即使其他生产密文为空，更换主密钥后启动也以 KEY_MISMATCH 失败；Run 秘密快照绑定自身记录。
   * @param column 保留密文的列：source、target 或 snapshot。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it.each(['source', 'target', 'snapshot'])(
    'validates the %s ENC column even when other production secrets are null',
    async (column) => {
      f = await m2Fixture({
        ENCRYPTION_MASTER_KEY: randomBytes(32).toString('base64'),
      });
      const job = f.job({
        source: {
          instanceId: f.id,
          path: '/source',
          password: 'source-path-secret',
        },
        targets: [
          { instanceId: f.id, path: '/target', password: 'target-path-secret' },
        ],
      });
      const run = f
        .runs()
        .trigger(job.id, { dryRun: true, confirmDeletes: false });
      const db = f.app.get(DatabaseService).db;
      const keys = f.app.get(KeysService);
      const stored = f.runs().record(run.id);
      if (!stored.secretSnapshotEnc)
        throw new Error('Expected encrypted snapshot');
      expect(
        JSON.parse(
          keys.decrypt(stored.secretSnapshotEnc, {
            table: 'runs',
            recordId: run.id,
            field: 'secret_snapshot_enc',
          }),
        ),
      ).toMatchObject({ sourcePassword: 'source-path-secret' });
      expect(
        /** 用 Job 源密码的绑定上下文解密 Run 秘密快照。
         * @param 不适用。
         * @returns 不适用。
         * @throws Error 预期的解密失败。
         */
        () =>
          keys.decrypt(stored.secretSnapshotEnc ?? '', {
            table: 'jobs',
            recordId: job.id,
            field: 'source_password_enc',
          }),
      ).toThrow();
      db.update(instances).set({ secretEnc: null }).run();
      if (column !== 'source')
        db.update(jobs).set({ sourcePasswordEnc: null }).run();
      if (column !== 'target')
        db.update(jobTargets).set({ passwordEnc: null }).run();
      if (column !== 'snapshot')
        db.update(runs).set({ secretSnapshotEnc: null }).run();
      await f.app.close();
      const broken = await constructApplication(
        environmentFor(f.directory.path, {
          ENCRYPTION_MASTER_KEY: randomBytes(32).toString('base64'),
        }),
      );
      await expect(initializeApplication(broken)).rejects.toMatchObject({
        code: 'KEY_MISMATCH',
      });
    },
  );
});
