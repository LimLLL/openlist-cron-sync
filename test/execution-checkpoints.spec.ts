// 从实际执行检查点截取已提交SQLite页，验证崩溃恢复而不手工伪造操作状态。
import Database from 'better-sqlite3';
import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { OperationStore } from '../src/sync/operation-store.js';
import { RelayService } from '../src/relay/relay.service.js';
import { RunsService } from '../src/runs/runs.service.js';
import { relayFixture } from './relay-fixture.js';
import { terminal } from './m2-fixture.js';
import {
  temporaryDirectory,
  environmentFor,
  startApplication,
} from './helpers.js';

/** 仅在测试内截取崩溃点；生产代码不增加故障开关或快照存储。
 * @param window 持久化检查点及其前后窗口。
 * @returns 完整真实执行与恢复验证。
 * @throws Error 注入故障、断言或资源清理失败。
 */
it.each([
  'submitting-before',
  'submitting-after',
  'session-before',
  'session-after',
  'eof-before',
  'eof-after',
  'completed-before',
  'completed-after',
  'result-before',
  'result-after',
  'confirming-before',
  'confirming-after',
] as const)('recovers the actual %s persistence window', async (window) => {
  const f = await relayFixture();
  const recovered = await temporaryDirectory();
  let app: NestExpressApplication | undefined;
  let image: Buffer | undefined;
  /** 只保存此刻已经提交的页，再阻止当前调用继续派发远端写入。
   * @param stage 当前检查点。
   * @returns 未命中时不适用。
   * @throws Error 命中时模拟进程丢失后续内存状态。
   */
  function crash(stage: string): void {
    if (window !== stage || image) return;
    const connection = new Database(join(f.directory.path, 'app.sqlite'), {
      readonly: true,
    });
    try {
      image = connection.serialize();
    } finally {
      connection.close();
    }
    throw new Error('Injected checkpoint crash');
  }
  try {
    // 崩溃进程没有机会abort远端；本地异常出口仍需退出，以免测试残留worker。
    vi.spyOn(f.app.get(RelayService), 'abort').mockResolvedValue();
    const submitting = OperationStore.prototype.submitting;
    vi.spyOn(OperationStore.prototype, 'submitting').mockImplementation(
      /** 在submitting事务前后截断实际调用。
       * @param id 当前操作。
       * @param signal 当前派发信号。
       * @returns 不适用。
       * @throws Error 注入故障或真实持久化失败。
       */
      function (this: OperationStore, id, signal) {
        crash('submitting-before');
        submitting.call(this, id, signal);
        crash('submitting-after');
      },
    );
    const session = OperationStore.prototype.session;
    vi.spyOn(OperationStore.prototype, 'session').mockImplementation(
      /** 区分收到init与complete响应后的两个持久化窗口。
       * @param id 当前操作。
       * @param value 已验证session事实。
       * @returns 不适用。
       * @throws Error 注入故障或真实持久化失败。
       */
      function (this: OperationStore, id, value) {
        const stage = value.state === 'completed' ? 'completed' : 'session';
        crash(stage + '-before');
        session.call(this, id, value);
        crash(stage + '-after');
      },
    );
    const eof = OperationStore.prototype.eof;
    vi.spyOn(OperationStore.prototype, 'eof').mockImplementation(
      /** 最后chunk不能越过EOF提交边界。
       * @param id 当前操作。
       * @returns 不适用。
       * @throws Error 注入故障或真实持久化失败。
       */
      function (this: OperationStore, id) {
        crash('eof-before');
        eof.call(this, id);
        crash('eof-after');
      },
    );
    const end = OperationStore.prototype.end;
    vi.spyOn(OperationStore.prototype, 'end').mockImplementation(
      /** 结果事务必须保留前一步已提交的completed证据。
       * @param id 当前操作。
       * @param outcome 实际执行结果。
       * @returns 是否写入终态。
       * @throws Error 注入故障或真实持久化失败。
       */
      function (this: OperationStore, id, outcome) {
        if (outcome.status === 'succeeded') crash('result-before');
        const changed = end.call(this, id, outcome);
        if (outcome.status === 'succeeded') crash('result-after');
        return changed;
      },
    );
    const confirming = OperationStore.prototype.confirming;
    vi.spyOn(OperationStore.prototype, 'confirming').mockImplementation(
      /** remove已生效但响应证据未落库时，恢复仍须保守判unknown。
       * @param id 当前删除。
       * @returns 不适用。
       * @throws Error 注入故障或真实持久化失败。
       */
      function (this: OperationStore, id) {
        crash('confirming-before');
        confirming.call(this, id);
        crash('confirming-after');
      },
    );
    if (window.startsWith('confirming'))
      f.files.set('/target/new.txt', Buffer.from('old'));
    const runId = f
      .runs()
      .trigger(f.job().id, { dryRun: false, confirmDeletes: true }).id;
    await terminal(f, runId);
    if (!image) throw new Error('Checkpoint not reached');
    vi.restoreAllMocks();
    await writeFile(join(recovered.path, 'app.sqlite'), image);
    await copyFile(
      join(f.directory.path, 'keys.json'),
      join(recovered.path, 'keys.json'),
    );
    const callsBeforeRecovery = f.server.calls.length;
    app = await startApplication(environmentFor(recovered.path));
    const runs = app.get(RunsService);
    await vi.waitFor(
      /** 等待恢复工作退出并提交Run终态。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 尚未恢复完成，由waitFor重试。
       */
      () => expect(runs.get(runId).status).toBe('interrupted'),
    );
    const actions = runs.operations(runId, {
      page: 1,
      pageSize: 100,
      includeMaintenance: false,
    }).items;
    const expected =
      window === 'submitting-before'
        ? 'skipped'
        : [
              'completed-after',
              'result-before',
              'result-after',
              'confirming-after',
            ].includes(window)
          ? 'succeeded'
          : 'unknown';
    expect(actions[0].status).toBe(expected);
    if (window.startsWith('confirming'))
      expect(actions[1].status).toBe('skipped');
    expect(
      f.server.calls.slice(callsBeforeRecovery).every(
        /** 恢复只能观察和abort，不能重放create或remove。
         * @param call 恢复期真实HTTP请求。
         * @returns 是否没有新的远端文件写入。
         * @throws 不适用。
         */
        (call) =>
          ![
            '/api/fs/multipart/init',
            '/api/fs/multipart/chunk',
            '/api/fs/multipart/complete',
            '/api/fs/remove',
            '/api/fs/put',
          ].includes(call.url),
      ),
    ).toBe(true);
  } finally {
    vi.restoreAllMocks();
    if (app) await app.close();
    await recovered.remove();
    await f.close();
  }
});
