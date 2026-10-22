// 验证task额度重建跨页、不重计重叠责任，也不恢复已结束的远端责任。
import { eq } from 'drizzle-orm';
import { copyFixture } from './copy-fixture.js';
import { preview } from './m2-fixture.js';
import { DatabaseService } from '../src/database/database.service.js';
import { operations } from '../src/database/operation-schema.js';
import { instances } from '../src/database/schema.js';
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
    expect(resources.count(f.id)).toBe(391);
    resources.release('restore-000');
    resources.release('restore-130');
    resources.release('restore-260');
    resources.release('restore-393');
    expect(resources.count(f.id)).toBe(387);
  } finally {
    await f.close();
  }
});

/** 零表示不限制提交数量，但仍保留内存中的ownership计数。 */
it('admits unlimited server-copy reservations when the snapshot quota is zero', async () => {
  const f = await copyFixture();
  try {
    const database = f.app.get(DatabaseService);
    database.db
      .update(instances)
      .set({ maxOutstandingTasks: 0 })
      .where(eq(instances.id, f.id))
      .run();
    const resources = new TaskResources(database);
    const instance = f.record();
    const reservations = await Promise.all(
      ['zero-1', 'zero-2', 'zero-3'].map((id) =>
        resources.reserve(instance, id, new AbortController().signal),
      ),
    );
    expect(reservations).toHaveLength(3);
    expect(resources.count(f.id)).toBe(3);
    resources.release('zero-1');
    resources.release('zero-2');
    resources.release('zero-3');
  } finally {
    await f.close();
  }
});
