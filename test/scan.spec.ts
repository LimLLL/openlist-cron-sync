// 用 F1 验证完整预览、后置阻断、目标根和空目录语义。
import { m2Fixture, listing, directory, preview, plan } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { file, envelope } from './openlist-fixture.js';
import { object, string } from '../src/openlist/errors.js';

/** 通过 F1 驱动完整 dry-run 预览，覆盖计划排序、后置删除阻断、目标根证明和空目录语义。
 * @param 不适用。
 * @returns 不适用。
 * @throws Error 断言失败。
 */
describe('M2 scanner', () => {
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
  /** 镜像预览按 seq 顺序生成完整候选，只调用只读端点，不写远程也不下载。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('plans complete mirror candidates in seq order without any remote write or download', async () => {
    f = await m2Fixture();
    f.tree.set(
      '/source',
      listing(file('same'), file('changed'), file('new'), directory('empty')),
    );
    f.tree.set('/source/empty', listing());
    f.tree.set(
      '/target',
      listing(
        file('same'),
        { ...file('changed'), size: 1 },
        file('extra'),
        directory('old'),
      ),
    );
    f.tree.set('/target/old', listing(file('nested')));
    const job = f.job({
      syncEmptyDirs: true,
      targets: [
        {
          instanceId: f.id,
          path: '/target',
          mode: 'mirror',
          deleteLimits: { maxPercent: 100 },
        },
      ],
    });
    const run = await preview(f, job);
    expect(run.status).toBe('succeeded');
    expect(run.targets[0].stats).toMatchObject({
      sourceFiles: 3,
      sourceDirectories: 1,
    });
    expect(run.stats).toMatchObject({
      plannedCreates: 2,
      plannedReplacements: 1,
      plannedExtraDeletes: 2,
      plannedDirectoryDeletes: 1,
      unchangedFiles: 1,
      succeededCreates: 0,
      transferredBytes: 0,
    });
    const ops = plan(f, run.id);
    expect(
      ops.map(
        /** 提取操作序号。
         * @param op 计划操作视图。
         * @returns 操作 seq。
         * @throws 不适用。
         */
        (op) => op.seq,
      ),
    ).toEqual(
      ops.map(
        /** 生成从 1 开始的连续序号。
         * @param _ 未使用的计划操作视图。
         * @param i 数组下标。
         * @returns 预期 seq。
         * @throws 不适用。
         */
        (_, i) => i + 1,
      ),
    );
    expect(
      ops.every(
        /** 检查操作仍为纯预览状态。
         * @param op 计划操作视图。
         * @returns 是否 pending 且无远程任务或 session。
         * @throws 不适用。
         */
        (op) =>
          op.status === 'pending' &&
          op.attempts[0].task === null &&
          op.attempts[0].multipart === null,
      ),
    ).toBe(true);
    expect(
      ops.findIndex(
        /** 定位嵌套文件的删除操作。
         * @param op 计划操作视图。
         * @returns 是否为 /target/old/nested。
         * @throws 不适用。
         */
        (op) => op.targetPath === '/target/old/nested',
      ),
    ).toBeLessThan(
      ops.findIndex(
        /** 定位其父目录的删除操作。
         * @param op 计划操作视图。
         * @returns 是否为 /target/old。
         * @throws 不适用。
         */
        (op) => op.targetPath === '/target/old',
      ),
    );
    expect(
      f.server.calls.every(
        /** 检查上游请求只命中认证、设置、列表和存储列表等只读端点。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 是否为只读端点。
         * @throws 不适用。
         */
        (call) =>
          ['/api/me', '/api/public/settings', '/api/fs/list'].includes(
            call.url,
          ) || call.url.startsWith('/api/admin/storage/list'),
      ),
    ).toBe(true);
    expect(JSON.stringify(run)).not.toContain('private-sign');
  });
  /** 晚发现的源子树失败必须阻断此前已落库的删除及其依赖新建。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('blocks earlier committed deletes and dependent creates after a late source subtree failure', async () => {
    f = await m2Fixture();
    f.tree.set(
      '/source',
      listing(file('changed'), file('new'), directory('bad')),
    );
    f.tree.set(
      '/target',
      listing({ ...file('changed'), size: 1 }, file('extra'), directory('bad')),
    );
    f.tree.set('/target/bad', listing());
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
      true,
    );
    expect(run.status).toBe('partial');
    expect(run.targets[0]).toMatchObject({
      sourceComplete: false,
      deleteBlocked: true,
      deleteBudgetCount: 0,
    });
    expect(run.stats).toMatchObject({
      plannedCreates: 2,
      plannedReplacements: 1,
      plannedExtraDeletes: 1,
      skippedOperations: 3,
    });
    expect(
      plan(f, run.id)
        .filter(
          /** 排除不依赖删除的纯新建操作。
           * @param op 计划操作视图。
           * @returns 是否不是 /target/new。
           * @throws 不适用。
           */
          (op) => op.targetPath !== '/target/new',
        )
        .every(
          /** 检查其余操作均因删除阻断而跳过。
           * @param op 计划操作视图。
           * @returns 是否为 DELETE_BLOCKED 跳过。
           * @throws 不适用。
           */
          (op) =>
            op.status === 'skipped' && op.error?.code === 'DELETE_BLOCKED',
        ),
    ).toBe(true);
  });
  /** 目标根缺失时以不刷新的父目录列表证明其不存在；空源仅在 syncEmptyDirs 开启时规划目标根创建。
   * @param syncEmptyDirs 是否同步空目录。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it.each([false, true])(
    'proves missing Target root and respects syncEmptyDirs=%s on an empty source',
    async (syncEmptyDirs) => {
      f = await m2Fixture();
      f.tree.set('/source', listing());
      f.tree.delete('/target');
      f.tree.set('/', listing(directory('source')));
      const run = await preview(
        f,
        f.job({ syncEmptyDirs, allowEmptySource: true }),
      );
      expect(run.status).toBe('succeeded');
      expect(plan(f, run.id)).toHaveLength(syncEmptyDirs ? 1 : 0);
      expect(run.issueCount).toBe(syncEmptyDirs ? 1 : 0);
      const proof = f.server.calls.find(
        /** 定位对根目录 / 的列表请求。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 是否为根目录列表请求。
         * @throws OpenListError 请求体不是对象。
         */
        (call) => call.url === '/api/fs/list' && object(call.json).path === '/',
      );
      expect(object(proof?.json).refresh).toBe(false);
    },
  );
  /** 目标根缺失时只为被包含的文件创建根和必要父目录，且不列出尚不存在的目标子目录。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('creates missing root and necessary parents only for included files', async () => {
    f = await m2Fixture();
    f.tree.set('/source', listing(directory('dir'), directory('empty')));
    f.tree.set('/source/dir', listing(file('x.jpg'), file('skip.log')));
    f.tree.set('/source/empty', listing());
    f.tree.delete('/target');
    f.tree.set('/', listing(directory('source')));
    const run = await preview(f, f.job({ filters: { include: ['**/*.jpg'] } }));
    expect(
      plan(f, run.id).map(
        /** 提取操作动作和目标路径。
         * @param op 计划操作视图。
         * @returns [action, targetPath] 二元组。
         * @throws 不适用。
         */
        (op) => [op.action, op.targetPath],
      ),
    ).toEqual([
      ['mkdir', '/target'],
      ['mkdir', '/target/dir'],
      ['create', '/target/dir/x.jpg'],
    ]);
    expect(
      f.server.calls
        .filter(
          /** 筛选列表请求。
           * @param call 捕获的真实 HTTP 请求。
           * @returns 是否为 /api/fs/list。
           * @throws 不适用。
           */
          (call) => call.url === '/api/fs/list',
        )
        .map(
          /** 提取列表请求的路径。
           * @param call 捕获的列表请求。
           * @returns 请求体中的 path。
           * @throws OpenListError 请求体或 path 类型不符。
           */
          (call) => string(object(call.json).path),
        ),
    ).not.toContain('/target/dir');
  });
  /** 目标根无权限、父目录失败或探测结果不可用时，标记 TARGET_ROOT_UNAVAILABLE 且不生成计划。
   * @param kind 根目录不可用的类型。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it.each(['permission', 'parent-failure', 'file', 'directory'])(
    'marks unavailable Target root for %s',
    async (kind) => {
      f = await m2Fixture();
      f.tree.set('/target', envelope(null, kind === 'permission' ? 403 : 500));
      if (kind === 'file') f.tree.set('/', listing(file('target')));
      if (kind === 'directory') f.tree.set('/', listing(directory('target')));
      const run = await preview(f, f.job());
      expect(run.status).toBe('partial');
      expect(plan(f, run.id)).toHaveLength(0);
      expect(run.targets[0].blockReasons).toContain('TARGET_ROOT_UNAVAILABLE');
    },
  );
  /** 仅目标侧的警告不降级 Run，含被排除文件的目录及其祖先永不删除。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('keeps target-only warnings non-degrading and never deletes protected directory ancestors', async () => {
    f = await m2Fixture();
    f.tree.set('/source', listing(file('same')));
    f.tree.set(
      '/target',
      listing(
        file('same'),
        file('A'),
        file('a'),
        { ...file('unknown'), size: -1 },
        file('bad/name'),
        file('extra'),
        directory('keep'),
      ),
    );
    f.tree.set('/target/keep', listing(file('excluded.log')));
    const run = await preview(
      f,
      f.job({
        syncEmptyDirs: true,
        filters: { exclude: ['**/*.log'] },
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
    expect(run.status).toBe('succeeded');
    expect(run.targets[0].extrasBlocked).toBe(false);
    expect(
      plan(f, run.id).map(
        /** 提取操作目标路径。
         * @param op 计划操作视图。
         * @returns targetPath。
         * @throws 不适用。
         */
        (op) => op.targetPath,
      ),
    ).toEqual(['/target/extra']);
    expect(run.targets[0].observedTargetFileCount).toBe(2);
  });
});
