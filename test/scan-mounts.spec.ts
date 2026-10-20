// 验证已保护挂载子树不能因其内部存在可用挂载而重新开放。
import { m2Fixture, listing, directory, preview, plan } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { envelope, file, storage } from './openlist-fixture.js';
import { object } from '../src/openlist/errors.js';

/** 注册完整映射与局部保护验收。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M2 protected mount ranges', () => {
  let f: M2Fixture;
  afterEach(
    /** 关闭本用例的真实网络和数据库资源。
     * @param 不适用。
     * @returns 清理完成。
     * @throws Error 清理失败。
     */
    async () => {
      if (f) await f.close();
    },
  );
  /** 保留独立旁支，整棵已保护子树不生成动作。
   * @param 不适用。
   * @returns 断言完成。
   * @throws Error 夹具或断言失败。
   */
  it('does not traverse a disabled mount into its nested active mount', async () => {
    f = await m2Fixture();
    const original = f.server.responder;
    f.server.responder =
      /** 提供禁用挂载及其内部可用挂载。
       * @param call 真实请求。
       * @returns 挂载列表或目录响应。
       * @throws Error 夹具失败。
       */
      (call) =>
        call.url.startsWith('/api/admin/storage/list')
          ? envelope({
              content: [
                storage(),
                { ...storage(2, '/source/blocked'), disabled: true },
                storage(3, '/source/blocked/nested'),
              ],
              total: 3,
            })
          : original?.(call);
    f.tree.set('/source', listing(directory('blocked'), directory('safe')));
    f.tree.set('/source/blocked', listing(directory('nested')));
    f.tree.set('/source/blocked/nested', listing(file('must-not-plan')));
    f.tree.set('/source/safe', listing(file('allowed')));
    f.tree.set('/target', listing(directory('blocked'), directory('safe')));
    f.tree.set('/target/safe', listing());
    const run = await preview(f, f.job());
    expect(run.status).toBe('partial');
    expect(plan(f, run.id)).toMatchObject([
      {
        action: 'create',
        targetPath: '/target/safe/allowed',
        status: 'pending',
      },
    ]);
    expect(plan(f, run.id)).toHaveLength(1);
    expect(
      f.runs().issues(run.id, { page: 1, pageSize: 50 }).items,
    ).toContainEqual(
      expect.objectContaining({
        path: '/source/blocked',
        code: 'SUSPECT_VIEW',
        protectSubtree: true,
      }),
    );
    for (const call of f.server.calls)
      if (call.url === '/api/fs/list')
        expect(object(call.json).path).not.toBe('/source/blocked/nested');
  });
  /** 不可写目标挂载同时是嵌套挂载祖先时，诊断须保留整树保护且不允许新建或下探。
   * @param 不适用。
   * @returns 诊断与计划断言完成。
   * @throws Error 夹具或断言失败。
   */
  it('preserves subtree protection for an unavailable Target mount with a nested mount', async () => {
    f = await m2Fixture();
    const original = f.server.responder;
    f.server.responder =
      /** 返回禁用目标挂载及其内部可用挂载，其他请求使用目录夹具。
       * @param call 真实 HTTP 请求。
       * @returns 完整挂载列表或原目录响应。
       * @throws Error 夹具响应失败。
       */
      (call) =>
        call.url.startsWith('/api/admin/storage/list')
          ? envelope({
              content: [
                storage(),
                { ...storage(2, '/target'), disabled: true },
                storage(3, '/target/nested'),
              ],
              total: 3,
            })
          : original?.(call);
    f.tree.set('/source', listing(file('new'), directory('nested')));
    f.tree.set('/source/nested', listing(file('child')));
    f.tree.set('/target', listing(directory('nested')));
    const run = await preview(f, f.job({ syncEmptyDirs: true }));
    expect(run.status).toBe('partial');
    expect(plan(f, run.id)).toEqual([]);
    expect(run.targets[0].observedTargetFileCount).toBe(0);
    expect(
      f.runs().issues(run.id, { page: 1, pageSize: 50 }).items,
    ).toContainEqual(
      expect.objectContaining({
        path: '/target',
        code: 'SUSPECT_VIEW',
        protectSubtree: true,
      }),
    );
    for (const call of f.server.calls)
      if (call.url === '/api/fs/list')
        expect(object(call.json).path).not.toBe('/target/nested');
  });
  /** 空挂载映射不等于已证明普通可写目录。
   * @param 不适用。
   * @returns 断言完成。
   * @throws Error 夹具或断言失败。
   */
  it('protects a directory with no backing storage in an otherwise complete admin map', async () => {
    f = await m2Fixture();
    const original = f.server.responder;
    f.server.responder =
      /** 返回完整但没有可用候选的映射。
       * @param call 真实请求。
       * @returns 映射或默认目录。
       * @throws Error 夹具失败。
       */
      (call) =>
        call.url.startsWith('/api/admin/storage/list')
          ? envelope({ content: [], total: 0 })
          : original?.(call);
    const run = await preview(f, f.job({ allowEmptySource: true }), true);
    expect(run.status).toBe('partial');
    expect(plan(f, run.id)).toHaveLength(0);
    expect(run.targets[0].blockReasons).toContain('SUSPECT_VIEW');
  });
  /** 可疑视图只禁止删除；源或目标任一侧可疑时新文件仍规划，替换与多余项受保护。
   * @param mount 嵌套挂载点，使其父目录成为可疑视图。
   * @returns 断言完成。
   * @throws Error 夹具或断言失败。
   */
  it.each(['/source/mounted', '/target/mounted'])(
    'keeps creating listed files in a suspect ancestor of %s but never replaces or deletes there',
    async (mount) => {
      f = await m2Fixture();
      const original = f.server.responder;
      f.server.responder =
        /** 返回让指定父目录成为挂载祖先的完整映射。
         * @param call 真实请求。
         * @returns 挂载列表或目录响应。
         * @throws Error 夹具失败。
         */
        (call) =>
          call.url.startsWith('/api/admin/storage/list')
            ? envelope({ content: [storage(), storage(2, mount)], total: 2 })
            : original?.(call);
      f.tree.set(
        '/source',
        listing(file('new.txt'), file('changed'), directory('mounted')),
      );
      f.tree.set('/source/mounted', listing());
      f.tree.set(
        '/target',
        listing(
          { ...file('changed'), size: 1 },
          file('extra'),
          directory('mounted'),
        ),
      );
      f.tree.set('/target/mounted', listing());
      const run = await preview(
        f,
        f.job({
          targets: [
            {
              instanceId: f.id,
              path: '/target',
              mode: 'mirror',
              deleteLimits: { enabled: false },
            },
          ],
        }),
      );
      const sourceSuspect = mount.startsWith('/source');
      expect(run.status).toBe('partial');
      // 可疑源文件不计入有效源，因此只有源侧可疑时会额外触发 EMPTY_SOURCE 全目标删除阻断。
      expect(run.targets[0]).toMatchObject({
        suspect: true,
        deleteBlocked: sourceSuspect,
        observedTargetFileCount: 0,
      });
      expect(run.targets[0].blockReasons).toContain('SUSPECT_VIEW');
      expect(run.targets[0].blockReasons.includes('EMPTY_SOURCE')).toBe(
        sourceSuspect,
      );
      expect(
        plan(f, run.id).map(
          /** 提取动作及路径，便于断言没有替换或删除。
           * @param op 计划操作。
           * @returns 动作、路径与状态。
           * @throws 不适用。
           */
          (op) => [op.action, op.targetPath, op.status],
        ),
      ).toEqual([['create', '/target/new.txt', 'pending']]);
      expect(run.stats.protectedFiles).toBe(2);
    },
  );
  /** 可疑祖先不抹掉已独立列举的有效空目录。
   * @param 不适用。
   * @returns 断言完成。
   * @throws Error 夹具或断言失败。
   */
  it('counts an independently confirmed empty source directory as effective source', async () => {
    f = await m2Fixture();
    const original = f.server.responder;
    f.server.responder =
      /** 在旁支放置一个已知挂载边界。
       * @param call 真实请求。
       * @returns 映射或目录响应。
       * @throws Error 夹具失败。
       */
      (call) =>
        call.url.startsWith('/api/admin/storage/list')
          ? envelope({
              content: [storage(), storage(2, '/source/mounted')],
              total: 2,
            })
          : original?.(call);
    f.tree.set('/source', listing(directory('safe')));
    f.tree.set('/source/safe', listing());
    f.tree.set('/target', listing(directory('safe')));
    f.tree.set('/target/safe', listing());
    const run = await preview(f, f.job({ syncEmptyDirs: true }));
    expect(run.targets[0].blockReasons).toContain('SUSPECT_VIEW');
    expect(run.targets[0].blockReasons).not.toContain('EMPTY_SOURCE');
    expect(run.targets[0].deleteBlocked).toBe(false);
  });
});
