// 为只读列表测试写入真实SQLite记录，不启动这些记录的后台执行。
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../src/configuration/app-config.js';
import { DatabaseService } from '../src/database/database.service.js';
import { runs } from '../src/database/run-schema.js';
import type { RunRecord } from '../src/database/run-schema.js';
import { instanceSnapshot } from '../src/jobs/endpoint-validation.js';
import type { Job } from '../src/jobs/job-types.js';
import { TERMINAL_RUNS } from '../src/runs/run-finalizer.js';
import { emptyStats } from '../src/sync/stats.js';
import type { M2Fixture } from './m2-fixture.js';

/** 构造仅用于列表查询的Run，保留真实外键、快照和状态约束。
 * @param fixture 已测试同一实例的M2夹具。
 * @param job 本例已持久化Job，端点均使用夹具实例。
 * @param overrides 本例需要的状态、时间或错误差异。
 * @returns 已插入的完整Run记录。
 * @throws Error 数据库约束或读取失败。
 */
export function seedListRun(
  fixture: M2Fixture,
  job: Job,
  overrides: Partial<RunRecord> = {},
): RunRecord {
  const createdAt = overrides.createdAt ?? Date.now();
  const status = overrides.status ?? 'succeeded';
  return fixture.app
    .get(DatabaseService)
    .db.insert(runs)
    .values({
      id: randomUUID(),
      jobId: job.id,
      trigger: 'manual',
      dryRun: false,
      confirmDeletes: false,
      status,
      config: {
        snapshotVersion: 1,
        job,
        instances: { [fixture.id]: instanceSnapshot(fixture.record()) },
        settings: fixture.app.get(AppConfig).execution,
      },
      stats: emptyStats(),
      createdAt,
      updatedAt: createdAt,
      startedAt: null,
      endedAt: TERMINAL_RUNS.includes(status) ? createdAt + 1 : null,
      queueDeadlineAt: createdAt + 60_000,
      ...overrides,
    })
    .returning()
    .get();
}
