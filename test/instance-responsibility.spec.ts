// 验证实例变更与三项真实责任谓词，以及事务内 ACCOUNT_CHANGED 保护。
import { eq } from 'drizzle-orm';
import { m2Fixture, preview, plan, terminal } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { latch, envelope } from './openlist-fixture.js';
import { InstancesService } from '../src/instances/instances.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { operations } from '../src/database/operation-schema.js';
import { hasResponsibility } from '../src/database/responsibility.js';
import { object } from '../src/openlist/errors.js';

/** 覆盖实例变更与三项真实责任谓词，以及责任期间的 ACCOUNT_CHANGED 保护。
 * @param 不适用。
 * @returns 不适用。
 * @throws Error 断言失败。
 */
describe('M2 instance responsibility', () => {
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
  /** 存在非终态 Run 时拒绝修改实例身份与下载模式，但允许改名和修复凭据。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('blocks identity and download mode changes for nonterminal Runs but permits names and credential repair', async () => {
    f = await m2Fixture();
    const release = latch();
    const entered = latch();
    const original = f.server.responder;
    f.server.responder =
      /** 列表请求挂起到门闩释放，使 Run 保持扫描中；其余请求交给原 responder。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 原 responder 的结果。
       * @throws 不适用。
       */
      async (call) => {
        if (call.url === '/api/fs/list') {
          entered.release();
          await release.promise;
        }
        return original?.(call);
      };
    const run = f
      .runs()
      .trigger(f.job().id, { dryRun: true, confirmDeletes: false });
    await entered.promise;
    const service = f.app.get(InstancesService);
    expect(
      /** 修改实例 baseUrl。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期的 Instance has outstanding responsibility。
       */
      () => service.patch(f.id, { baseUrl: f.server.baseUrl + '/changed' }),
    ).toThrow('Instance has outstanding responsibility');
    expect(
      /** 修改实例下载模式。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期的 Instance has outstanding responsibility。
       */
      () => service.patch(f.id, { downloadMode: 'p' }),
    ).toThrow('Instance has outstanding responsibility');
    expect(service.patch(f.id, { name: 'Renamed' }).name).toBe('Renamed');
    expect(
      service.patch(f.id, { auth: { mode: 'token', secret: 'repaired-token' } })
        .authState,
    ).toBe('untested');
    release.release();
    await terminal(f, run.id);
  });
  /** 责任期间 /me 返回不同账号时保留旧身份，并持久化 ACCOUNT_CHANGED 认证阻断。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('preserves old identity and persists ACCOUNT_CHANGED when /me changes under responsibility', async () => {
    f = await m2Fixture();
    const release = latch();
    const entered = latch();
    const original = f.server.responder;
    let changed = false;
    f.server.responder =
      /** 切换后 /me 返回另一账号；源根列表挂起到门闩释放；其余请求交给原 responder。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 账号响应或原 responder 的结果。
       * @throws OpenListError 请求体不是对象。
       */
      async (call) => {
        if (call.url === '/api/me' && changed)
          return envelope({
            username: 'different',
            base_path: '/different',
            role: 2,
            permission: 255,
          });
        if (
          call.url === '/api/fs/list' &&
          object(call.json).path === '/source'
        ) {
          entered.release();
          await release.promise;
        }
        return original?.(call);
      };
    const run = f
      .runs()
      .trigger(f.job().id, { dryRun: true, confirmDeletes: false });
    await entered.promise;
    changed = true;
    await expect(f.client.auth.account(f.record(), true)).rejects.toMatchObject(
      { code: 'AUTH_BLOCKED' },
    );
    expect(f.record()).toMatchObject({
      accountUsername: 'admin',
      accountBasePath: '/',
      authState: 'auth_blocked',
      authBlockReason: 'ACCOUNT_CHANGED',
    });
    release.release();
    await terminal(f, run.id);
  });
  /** Job 归档后，未解决的 unknown 操作和待清理的远程任务仍构成实例责任并阻止归档实例。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('keeps unresolved unknown and pending remote cleanup as real responsibility after Job archive', async () => {
    f = await m2Fixture();
    const job = f.job();
    const run = await preview(f, job);
    const op = plan(f, run.id)[0];
    const db = f.app.get(DatabaseService).db;
    const now = Date.now();
    db.update(operations)
      .set({
        status: 'unknown',
        endedAt: now,
        unknownSince: now,
        unknownUntil: now + 1000,
      })
      .where(eq(operations.id, op.id))
      .run();
    f.jobs().archive(job.id);
    expect(hasResponsibility(db, f.id)).toBe(true);
    expect(
      /** 归档仍有责任的实例。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期的 Instance is referenced。
       */
      () => f.app.get(InstancesService).archive(f.id),
    ).toThrow('Instance is referenced');
    db.update(operations)
      .set({
        resolutionKind: 'abandoned',
        resolutionNote: 'fixture decision',
        resolvedAt: now,
      })
      .where(eq(operations.id, op.id))
      .run();
    expect(hasResponsibility(db, f.id)).toBe(false);
    db.update(operations)
      .set({
        method: 'server_copy',
        openlistTaskId: 'fixture-task',
        remoteCleanupPending: true,
      })
      .where(eq(operations.id, op.id))
      .run();
    expect(hasResponsibility(db, f.id)).toBe(true);
    db.update(operations)
      .set({ remoteCleanupPending: false })
      .where(eq(operations.id, op.id))
      .run();
    f.app.get(InstancesService).archive(f.id);
  });
});
