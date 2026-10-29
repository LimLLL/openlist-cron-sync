// 验证同一 Run 的混合创建、删除、聚合带宽与两种未决操作的启动恢复。
import { eq } from 'drizzle-orm';
import { copyFixture } from './copy-fixture.js';
import type { CopyFixture } from './copy-fixture.js';
import { preview, plan, terminal } from './m2-fixture.js';
import { InstancesService } from '../src/instances/instances.service.js';
import { InstanceOperations } from '../src/instances/instance-operations.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { operations } from '../src/database/operation-schema.js';
import { runs } from '../src/database/run-schema.js';
import { OpenListMultipart } from '../src/openlist/multipart.service.js';
import { TaskResources } from '../src/coordination/task-resources.js';
import { setOperation } from './operation-fixture.js';

/** 注册混合传输真实执行验收，网络服务仅使用测试夹具。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('mixed create modes in one Run', () => {
  let f: CopyFixture;
  let other: string;
  /** 建立支持两种传输的服务和独立 Target 实例身份。
   * @param 不适用。
   * @returns 夹具就绪。
   * @throws Error 初始化失败。
   */
  beforeEach(async () => {
    f = await copyFixture();
    other = f.app.get(InstancesService).create({
      name: 'Relay destination',
      baseUrl: f.server.baseUrl,
      auth: { mode: 'token', secret: 'relay-instance-token' },
    }).id;
    await f.app.get(InstanceOperations).test(other, { retryAuth: false });
    f.files.set('/copy', null);
    f.files.set('/relay', null);
  });
  /** 释放独立夹具。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 资源释放失败。
   */
  afterEach(async () => {
    await f.close();
  });
  /** 创建包含同实例 copy 和跨实例 relay 的 Job。
   * @param bandwidth Job 聚合带宽。
   * @returns 已保存 Job。
   * @throws Error 配置保存失败。
   */
  function mixedJob(bandwidth = 0) {
    return f.job({
      relayBandwidthLimit: bandwidth,
      targets: [
        {
          instanceId: f.id,
          path: '/copy',
          mode: 'mirror',
          createMode: 'server_copy',
        },
        {
          instanceId: other,
          path: '/relay',
          mode: 'mirror',
          createMode: 'relay',
        },
      ],
    });
  }
  /** 两类 Target 的新建、替换和 extras 共存，copy 可同步成功或产生 task。
   * @param withTask 是否由服务端返回后台任务。
   * @returns 执行完成。
   * @throws Error 断言失败。
   */
  it.each([false, true])(
    'executes mixed new/replacement/mirror operations (task=%s)',
    async (withTask) => {
      f.withTask = withTask;
      f.files.set('/source/another.txt', Buffer.from('another'));
      for (const path of ['/copy', '/relay']) {
        f.files.set(path + '/new.txt', Buffer.from('old'));
        f.files.set(path + '/extra.txt', Buffer.from('extra'));
      }
      const job = mixedJob();
      const result = await terminal(
        f,
        f.runs().trigger(job.id, { dryRun: false, confirmDeletes: true }).id,
      );
      expect(result.status).toBe('succeeded');
      const planned = plan(f, result.id);
      for (const op of planned)
        expect(op.method).toBe(
          op.action === 'delete'
            ? 'remove'
            : op.targetPath.startsWith('/copy/')
              ? 'server_copy'
              : 'relay',
        );
      for (const path of ['/copy', '/relay']) {
        expect(f.files.get(path + '/new.txt')).toEqual(
          f.files.get('/source/new.txt'),
        );
        expect(f.files.get(path + '/another.txt')).toEqual(
          f.files.get('/source/another.txt'),
        );
        expect(f.files.has(path + '/extra.txt')).toBe(false);
      }
      expect(f.copyCount).toBe(2);
      expect(result.stats).toMatchObject({
        sourceFiles: 2,
        succeededCreates: 4,
        deletedForReplace: 2,
        deletedAsExtra: 2,
        downloadedBytes: 19,
        transferredBytes: 19,
      });
      expect(result.targets[0].stats).toMatchObject({
        downloadedBytes: 0,
        transferredBytes: 0,
      });
      expect(f.app.get(TaskResources).count(result.targets[0].id)).toBe(0);
      expect(f.tasks.size).toBe(0);
    },
  );
  /** 两个 relay 目标共享一个带宽上限，copy 不计入上传字节。
   * @param 不适用。
   * @returns 执行完成。
   * @throws Error 断言失败。
   */
  it('shares the Job upload cap across relay Targets and excludes copy bytes', async () => {
    f.files.set('/relay-second', null);
    const job = mixedJob(12);
    f.jobs().patch(job.id, {
      targets: [
        { id: job.targets[0].id },
        { id: job.targets[1].id },
        { instanceId: other, path: '/relay-second' },
      ],
    });
    const started = performance.now();
    const result = await terminal(
      f,
      f.runs().trigger(job.id, { dryRun: false, confirmDeletes: false }).id,
    );
    expect(result.status).toBe('succeeded');
    // 桶初始允许一秒突发；两个 12 字节上传共享 12 bytes/s 至少再等待一秒。
    expect(performance.now() - started).toBeGreaterThanOrEqual(900);
    expect(result.stats).toMatchObject({
      succeededCreates: 3,
      downloadedBytes: 24,
      transferredBytes: 24,
    });
    expect(result.targets[0].stats.transferredBytes).toBe(0);
    expect(
      result.targets.slice(1).map((target) => target.stats.transferredBytes),
    ).toEqual([12, 12]);
  });
  /** 同一 Run 恢复 copy task 与 relay session，不能重放任一创建操作。
   * @param 不适用。
   * @returns 恢复完成。
   * @throws Error 断言失败。
   */
  it('recovers copy responsibility and aborts relay independently without replay', async () => {
    const result = await preview(f, mixedJob());
    const [copy, relay] = plan(f, result.id);
    const otherRecord = f.app.get(InstancesService).record(other);
    const session = await f.app
      .get(OpenListMultipart)
      .init(otherRecord, { directory: '/relay', name: 'new.txt' }, 12);
    f.tasks.set('mixed-recovered-task', {
      state: 2,
      source: '/source/new.txt',
      destination: '/copy/new.txt',
    });
    const db = f.app.get(DatabaseService).db;
    setOperation(db, eq(operations.id, copy.id), {
      status: 'submitted',
      openlistTaskId: 'mixed-recovered-task',
      remoteState: 0,
    });
    setOperation(db, eq(operations.id, relay.id), {
      status: 'running',
      multipartUploadId: session.uploadId,
      multipartChunkSize: session.chunkSize,
      multipartAttempt: session.attempt,
      multipartState: 'receiving',
    });
    db.update(runs)
      .set({ status: 'executing', dryRun: false, endedAt: null })
      .where(eq(runs.id, result.id))
      .run();
    const before = f.server.calls.length;
    await f.restart();
    const restored = await terminal(f, result.id);
    expect(restored.status).toBe('interrupted');
    expect(plan(f, result.id).map((op) => [op.method, op.status])).toEqual([
      ['server_copy', 'succeeded'],
      ['relay', 'unknown'],
    ]);
    expect(restored.config).toEqual(result.config);
    const urls = f.server.calls.slice(before).map((call) => call.url);
    expect(urls).toContain('/api/fs/multipart/abort');
    expect(urls.some((url) => url.startsWith('/api/task/copy/info'))).toBe(
      true,
    );
    expect(urls).not.toContain('/api/fs/copy');
    expect(urls).not.toContain('/api/fs/multipart/init');
    expect(urls).not.toContain('/api/fs/multipart/chunk');
    expect(f.app.get(TaskResources).count(result.targets[0].id)).toBe(0);
  });
});
