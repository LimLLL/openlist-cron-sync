// 验证task额度重建跨页、不重计重叠责任，也不恢复已结束的远端责任。
import { eq } from 'drizzle-orm';
import { copyFixture } from './copy-fixture.js';
import { preview } from './m2-fixture.js';
import { DatabaseService } from '../src/database/database.service.js';
import { operations } from '../src/database/operation-schema.js';
import { runTargets } from '../src/database/run-schema.js';
import { TaskResources } from '../src/coordination/task-resources.js';

/** 两类索引候选跨越128行分页边界，重叠行只占一个名额。
 * @param 不适用。
 * @returns 验证完成。
 * @throws Error SQL或断言失败。
 */
it('restores paged task responsibility once and excludes released occupancy', async () => {
  const f = await copyFixture();
  try {
    const run = await preview(f, f.copyJob());
    const database = f.app.get(DatabaseService);
    const db = database.db;
    const original = db
      .select()
      .from(operations)
      .where(eq(operations.runId, run.id))
      .get();
    if (!original) throw new Error('Missing copy plan');
    db.transaction(
      /** 写入三组跨页候选及不应占位的历史行。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error SQL失败。
       */
      () => {
        for (let index = 0; index < 396; index++) {
          const id = `restore-${index.toString().padStart(3, '0')}`;
          // 前390行分别为flag-only、flag+inflight和inflight-only。
          const status =
            index < 130
              ? 'unknown'
              : index < 260
                ? 'submitted'
                : index < 390
                  ? 'running'
                  : 'unknown';
          db.insert(operations)
            .values({
              ...original,
              id,
              seq: index + 2,
              status,
              endedAt: status === 'unknown' ? 1 : null,
              unknownSince: status === 'unknown' ? 1 : null,
              unknownUntil: status === 'unknown' ? 2 : null,
              openlistTaskId: index === 394 ? null : id,
              remoteCleanupPending:
                index < 260 || (index >= 390 && index < 394),
              remoteState:
                index >= 390 && index < 393
                  ? [2, 4, 7][index - 390]
                  : index === 0
                    ? null
                    : 1,
              // 已放弃unknown仍保留flag时必须恢复额度，resolution本身不释放。
              resolutionKind: index === 393 ? 'abandoned' : null,
              resolutionNote: index === 393 ? 'Accepted incident' : null,
              resolvedAt: index === 393 ? 3 : null,
            })
            .run();
        }
      },
    );
    const resources = new TaskResources(database);
    resources.restore();
    expect(resources.count(original.runTargetId)).toBe(391);
    resources.release('restore-000');
    resources.release('restore-130');
    resources.release('restore-260');
    resources.release('restore-393');
    expect(resources.count(original.runTargetId)).toBe(387);
  } finally {
    await f.close();
  }
});

/** 零表示不限制提交数量，但仍保留内存中的ownership计数。 */
it('admits unlimited server-copy reservations when the snapshot quota is zero', async () => {
  const f = await copyFixture();
  try {
    const database = f.app.get(DatabaseService);
    const run = await preview(f, f.copyJob());
    const original = database.db
      .select()
      .from(runTargets)
      .where(eq(runTargets.runId, run.id))
      .get();
    if (!original) throw new Error('Missing Run Target');
    const resources = new TaskResources(database);
    const reservations = await Promise.all(
      ['zero-1', 'zero-2', 'zero-3'].map((id) =>
        resources.reserve(original.id, 0, id, new AbortController().signal),
      ),
    );
    expect(reservations).toHaveLength(3);
    expect(resources.count(original.id)).toBe(3);
    resources.release('zero-1');
    resources.release('zero-2');
    resources.release('zero-3');
  } finally {
    await f.close();
  }
});

/** 同一稳定Target跨Run共享未结束任务额度，不同Job/Target额度分别计数。
 * @returns 验证完成。
 * @throws Error 夹具或断言失败。
 */
it('retains a stable Target quota across Runs and isolates another Job', async () => {
  const f = await copyFixture();
  try {
    const job = f.copyJob();
    const first = await preview(f, job);
    const next = await preview(f, job);
    const other = await preview(f, f.copyJob());
    const resources = f.app.get(TaskResources);
    const signal = AbortSignal.timeout(5000);
    await resources.reserve(first.targets[0].id, 1, 'old-task', signal);
    expect(resources.count(next.targets[0].id)).toBe(1);
    let admitted = false;
    const waiting = resources
      .reserve(next.targets[0].id, 1, 'new-task', signal)
      .then(() => {
        admitted = true;
      });
    await resources.reserve(other.targets[0].id, 1, 'other-task', signal);
    expect(admitted).toBe(false);
    resources.release('old-task');
    await waiting;
    expect(resources.count(next.targets[0].id)).toBe(1);
    resources.release('new-task');
    resources.release('other-task');
  } finally {
    await f.close();
  }
});
