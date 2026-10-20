// 验证资源上限、局部深度保护、可疑视图与多目标失败隔离。
import { m2Fixture, listing, directory, preview, plan } from './m2-fixture.js';
import type { M2Fixture } from './m2-fixture.js';
import { file, envelope, storage } from './openlist-fixture.js';
import { object } from '../src/openlist/errors.js';

/** 覆盖扫描资源上限、深度保护、可疑挂载视图、删除阈值与多目标失败隔离。
 * @param 不适用。
 * @returns 不适用。
 * @throws Error 断言失败。
 */
describe('M2 scan limits and safety', () => {
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
  /** 任一扫描资源上限触发时整个 Run 以 RESOURCE_LIMIT 失败而非截断，已落库操作标记 PLAN_INTERRUPTED。
   * @param name 上限环境变量名。
   * @param limit 上限值。
   * @param kind 触发上限的资源类型。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it.each([
    ['SCAN_MAX_DIRECTORY_ENTRIES', '1', 'entries'],
    ['MAX_OPERATIONS_PER_RUN', '1', 'operations'],
    ['MAX_SCAN_ISSUES_PER_RUN', '1', 'issues'],
    ['OPENLIST_MAX_JSON_BYTES', '1024', 'bytes'],
  ])(
    'fails the entire Run on %s instead of truncating',
    async (name, limit, kind) => {
      f = await m2Fixture({ [name]: limit });
      f.tree.set(
        '/source',
        kind === 'bytes'
          ? { body: ' '.repeat(2048) }
          : kind === 'issues'
            ? listing({ ...file('a'), size: -1 }, { ...file('b'), size: -1 })
            : listing(file('a'), file('b')),
      );
      const run = await preview(f, f.job());
      expect(run).toMatchObject({
        status: 'failed',
        error: { code: 'RESOURCE_LIMIT' },
        scanCompletedAt: null,
      });
      expect(
        plan(f, run.id).every(
          /** 检查操作因计划中断而跳过。
           * @param op 计划操作视图。
           * @returns 是否为 PLAN_INTERRUPTED 跳过。
           * @throws 不适用。
           */
          (op) =>
            op.status === 'skipped' && op.error?.code === 'PLAN_INTERRUPTED',
        ),
      ).toBe(true);
    },
  );
  /** 非法名称按原始条目计入目录条目上限，操作数恰好等于上限时允许。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('counts raw invalid names toward directory limit and accepts the exact operation limit', async () => {
    f = await m2Fixture({
      SCAN_MAX_DIRECTORY_ENTRIES: '1',
      MAX_OPERATIONS_PER_RUN: '1',
    });
    let run = await preview(f, f.job());
    expect(run.status).toBe('succeeded');
    expect(plan(f, run.id)).toHaveLength(1);
    f.tree.set('/source', listing(file('valid'), file('bad/name')));
    run = await preview(f, f.job());
    expect(run.error?.code).toBe('RESOURCE_LIMIT');
  });
  /** 源根列表失败或条目大小非法时映射为 SOURCE_ROOT_UNAVAILABLE，且不生成计划。
   * @param kind 源根失败类型：HTTP 状态码或 invalid-size。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it.each([500, 403, 'invalid-size'] as const)(
    'maps source root failure %s to SOURCE_ROOT_UNAVAILABLE',
    async (kind) => {
      f = await m2Fixture();
      f.tree.set(
        '/source',
        kind === 'invalid-size'
          ? listing({ ...file(), size: Number.MAX_SAFE_INTEGER + 1 })
          : envelope(null, kind),
      );
      const run = await preview(f, f.job());
      expect(run.error?.code).toBe('SOURCE_ROOT_UNAVAILABLE');
      expect(plan(f, run.id)).toHaveLength(0);
    },
  );
  /** 超过扫描深度时记录问题并阻断受影响子树，已确认的新文件仍待执行，超深目录不被列出。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('bounds depth with an issue while preserving confirmed new files', async () => {
    f = await m2Fixture({ SCAN_MAX_DEPTH: '1' });
    f.tree.set('/source', listing(file('new'), directory('a')));
    f.tree.set('/source/a', listing(directory('b')));
    f.tree.set('/target', listing(file('extra'), directory('a')));
    f.tree.set('/target/a', listing());
    const run = await preview(
      f,
      f.job({
        syncEmptyDirs: true,
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
    expect(run.status).toBe('partial');
    expect(run.targets[0].blockReasons).toContain('SCAN_DEPTH_EXCEEDED');
    expect(
      plan(f, run.id).find(
        /** 定位新文件的创建操作。
         * @param op 计划操作视图。
         * @returns 是否为 /target/new。
         * @throws 不适用。
         */
        (op) => op.targetPath === '/target/new',
      )?.status,
    ).toBe('pending');
    expect(
      plan(f, run.id).some(
        /** 检查是否存在超深目录的操作。
         * @param op 计划操作视图。
         * @returns 是否为 /target/a/b。
         * @throws 不适用。
         */
        (op) => op.targetPath === '/target/a/b',
      ),
    ).toBe(false);
    expect(
      f.server.calls.some(
        /** 检查是否列出了超出深度的源目录。
         * @param call 捕获的真实 HTTP 请求。
         * @returns 是否为 /source/a/b 的列表请求。
         * @throws OpenListError 请求体不是对象。
         */
        (call) =>
          call.url === '/api/fs/list' &&
          object(call.json).path === '/source/a/b',
      ),
    ).toBe(false);
  });
  /** 某一目标子树不完整时只阻断该目标的删除，另一目标的计划保持待执行。
   * @param batchSize 计划和安全检查批次大小；覆盖依赖跨批次的情况。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it.each([1, 3])(
    'blocks only the incomplete Target with batch size %s',
    async (batchSize) => {
      f = await m2Fixture({ PLAN_BATCH_SIZE: String(batchSize) });
      f.tree.set(
        '/source',
        listing(file('changed'), file('changed-again'), directory('child')),
      );
      f.tree.set('/source/child', listing(file('new')));
      for (const path of ['/target', '/second'])
        f.tree.set(
          path,
          listing(
            { ...file('changed'), size: 1 },
            { ...file('changed-again'), size: 1 },
            directory('child'),
          ),
        );
      f.tree.set('/second/child', listing());
      const run = await preview(
        f,
        f.job({
          targets: ['/target', '/second'].map(
            /** 为目标路径构造关闭删除阈值的目标配置。
             * @param path 目标路径。
             * @returns 目标创建请求。
             * @throws 不适用。
             */
            (path) => ({
              instanceId: f.id,
              path,
              deleteLimits: { enabled: false },
            }),
          ),
        }),
      );
      expect(
        run.targets.map(
          /** 提取目标的删除阻断标志。
           * @param target Run 目标视图。
           * @returns deleteBlocked。
           * @throws 不适用。
           */
          (target) => target.deleteBlocked,
        ),
      ).toEqual([true, false]);
      expect(run.stats).toMatchObject({
        plannedReplacements: 4,
        skippedOperations: 4,
      });
      expect(
        plan(f, run.id)
          .filter(
            /** 筛选第一个目标下的操作。
             * @param op 计划操作视图。
             * @returns 是否位于 /target/ 下。
             * @throws 不适用。
             */
            (op) => op.targetPath.startsWith('/target/'),
          )
          .every(
            /** 检查操作已跳过。
             * @param op 计划操作视图。
             * @returns 是否为 skipped。
             * @throws 不适用。
             */
            (op) => op.status === 'skipped',
          ),
      ).toBe(true);
      expect(
        plan(f, run.id)
          .filter(
            /** 筛选第二个目标下的操作。
             * @param op 计划操作视图。
             * @returns 是否位于 /second/ 下。
             * @throws 不适用。
             */
            (op) => op.targetPath.startsWith('/second/'),
          )
          .every(
            /** 检查操作仍待执行。
             * @param op 计划操作视图。
             * @returns 是否为 pending。
             * @throws 不适用。
             */
            (op) => op.status === 'pending',
          ),
      ).toBe(true);
    },
  );
  /** 替换与多余删除合并计入删除阈值，超限时跳过删除类操作而新文件保持待执行；确认覆盖后不再限制。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('uses combined replacement and extra thresholds and leaves new files pending', async () => {
    f = await m2Fixture();
    f.tree.set('/source', listing(file('changed'), file('new')));
    f.tree.set(
      '/target',
      listing({ ...file('changed'), size: 1 }, file('extra')),
    );
    const job = f.job({
      targets: [
        {
          instanceId: f.id,
          path: '/target',
          mode: 'mirror',
          deleteLimits: { maxCount: 1, maxPercent: 100 },
        },
      ],
    });
    let run = await preview(f, job);
    expect(run.stats.skippedOperations).toBe(3);
    expect(run.targets[0].deleteBudgetCount).toBe(1);
    expect(
      plan(f, run.id)
        .filter(
          /** 筛选已跳过的操作。
           * @param op 计划操作视图。
           * @returns 是否为 skipped。
           * @throws 不适用。
           */
          (op) => op.status === 'skipped',
        )
        .every(
          /** 检查跳过原因为删除阈值。
           * @param op 计划操作视图。
           * @returns 是否为 DELETE_LIMIT。
           * @throws 不适用。
           */
          (op) => op.error?.code === 'DELETE_LIMIT',
        ),
    ).toBe(true);
    run = await preview(f, job, true);
    expect(run.status).toBe('succeeded');
    expect(run.targets[0].deleteBudgetCount).toBeNull();
  });
  /** 源非空但过滤后无受管理文件时仍触发 EMPTY_SOURCE，确认覆盖也不能放行删除。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('does not treat a nonempty filtered source as empty-source authorization', async () => {
    f = await m2Fixture();
    f.tree.set('/source', listing(file('skip.log')));
    f.tree.set('/target', listing(file('extra.jpg')));
    const run = await preview(
      f,
      f.job({
        filters: { include: ['*.jpg'] },
        targets: [{ instanceId: f.id, path: '/target', mode: 'mirror' }],
      }),
      true,
    );
    expect(run.targets[0].blockReasons).toContain('EMPTY_SOURCE');
    expect(plan(f, run.id)[0]).toMatchObject({
      status: 'skipped',
      error: { code: 'DELETE_BLOCKED' },
    });
  });
  /** 挂载点祖先被标记为可疑视图并阻断多余删除，独立分支的替换仍待执行。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('marks suspect ancestors without blocking independent replacement branches', async () => {
    f = await m2Fixture();
    const responder = f.server.responder;
    f.server.responder =
      /** 存储列表请求返回一个位于源内的挂载点，其余请求交给原 responder。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 存储列表响应或原 responder 的结果。
       * @throws 不适用。
       */
      (call) =>
        call.url.startsWith('/api/admin/storage/list')
          ? envelope({
              content: [storage(), storage(2, '/source/mounted')],
              total: 2,
            })
          : responder?.(call);
    f.tree.set('/source', listing(directory('safe'), directory('mounted')));
    f.tree.set('/target', listing(directory('safe'), directory('mounted')));
    f.tree.set('/source/safe', listing(file('changed')));
    f.tree.set('/target/safe', listing({ ...file('changed'), size: 1 }));
    f.tree.set('/source/mounted', listing());
    f.tree.set('/target/mounted', listing());
    const run = await preview(
      f,
      f.job({
        targets: [
          {
            instanceId: f.id,
            path: '/target',
            deleteLimits: { enabled: false },
          },
        ],
      }),
    );
    expect(run.targets[0]).toMatchObject({
      suspect: true,
      deleteBlocked: false,
      extrasBlocked: true,
    });
    expect(
      plan(f, run.id).every(
        /** 检查操作仍待执行。
         * @param op 计划操作视图。
         * @returns 是否为 pending。
         * @throws 不适用。
         */
        (op) => op.status === 'pending',
      ),
    ).toBe(true);
  });
  /** 管理员挂载枚举失败时不退化为非管理员规则，而以 MOUNT_BOUNDARY_UNKNOWN 阻断删除。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('does not downgrade failed admin mount enumeration to non-admin rules', async () => {
    f = await m2Fixture();
    const responder = f.server.responder;
    f.server.responder =
      /** 存储列表请求返回 403，其余请求交给原 responder。
       * @param call 捕获的真实 HTTP 请求。
       * @returns 403 响应或原 responder 的结果。
       * @throws 不适用。
       */
      (call) =>
        call.url.startsWith('/api/admin/storage/list')
          ? envelope(null, 403)
          : responder?.(call);
    f.tree.set('/target', listing({ ...file('new.txt'), size: 1 }));
    const run = await preview(f, f.job(), true);
    expect(run.targets[0].blockReasons).toContain('MOUNT_BOUNDARY_UNKNOWN');
    expect(
      plan(f, run.id).every(
        /** 检查操作因删除阻断而跳过。
         * @param op 计划操作视图。
         * @returns 是否为 DELETE_BLOCKED 跳过。
         * @throws 不适用。
         */
        (op) => op.status === 'skipped' && op.error?.code === 'DELETE_BLOCKED',
      ),
    ).toBe(true);
  });
  /** 计划字节合计溢出时 Run 以 RESOURCE_LIMIT 失败，不执行部分计划。
   * @param 不适用。
   * @returns 完成 Promise。
   * @throws Error 断言或夹具失败。
   */
  it('fails on aggregate byte overflow without executing a partial plan', async () => {
    f = await m2Fixture();
    f.tree.set(
      '/source',
      listing({ ...file('a'), size: Number.MAX_SAFE_INTEGER }, file('b')),
    );
    const run = await preview(f, f.job());
    expect(run.error?.code).toBe('RESOURCE_LIMIT');
    expect(
      plan(f, run.id).every(
        /** 检查已落库操作均被跳过。
         * @param op 计划操作视图。
         * @returns 是否为 skipped。
         * @throws 不适用。
         */
        (op) => op.status === 'skipped',
      ),
    ).toBe(true);
  });
});
