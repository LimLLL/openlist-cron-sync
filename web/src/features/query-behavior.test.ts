// 使用真实 QueryClient 验证取数层的请求路径、全量分页、轮询节奏与缓存失效；只替换 React hooks 的挂载边界。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { useHealth } from './system/health-queries';
import { useOperations } from './operations/operation-queries';
import { parseEmpty } from '../lib/parsers';
import {
  useArchiveInstance,
  useInstanceCatalog,
  useInstanceTest,
} from './instances/instance-queries';
import {
  jobKeys,
  useArchiveJob,
  useJobCatalog,
  usePatchJob,
  useToggleJob,
  useTriggerRun,
} from './jobs/job-queries';
import {
  runKeys,
  useActiveRuns,
  useActiveRunsOwner,
  useRun,
  useRunIssues,
  useRunOperations,
  useRuns,
  useCancelRun,
  useRetryRun,
} from './runs/run-queries';

/** 测试读取的查询 hook 参数。 */
interface QueryOptions {
  /** 缓存标识。 */
  queryKey: readonly unknown[];
  /** 接受真实取消信号的请求。 */
  queryFn: (context: { signal: AbortSignal }) => Promise<unknown>;
  /** 是否启用。 */
  enabled?: boolean;
  /** 固定或动态轮询间隔。 */
  refetchInterval?:
    number | false | ((query: { state: { data?: unknown } }) => number | false);
}
/** 测试调用的 mutation 配置。 */
interface MutationOptions {
  /** 提交函数。 */
  mutationFn: (value?: unknown) => Promise<unknown>;
  /** 成功后的缓存处理。 */
  onSuccess?: (data: unknown, variables?: unknown) => void;
  /** 结束（成功或失败）后的缓存处理。 */
  onSettled?: (
    data: unknown,
    error: unknown,
    variables?: unknown,
  ) => void | Promise<unknown>;
}
const capture = vi.hoisted(() => ({
  query: null as QueryOptions | null,
  mutation: null as MutationOptions | null,
  result: {} as Record<string, unknown>,
  ref: { current: undefined as unknown },
  request: vi.fn(),
  session: { mustChangePassword: false } as {
    mustChangePassword: boolean;
  } | null,
}));
const client = new QueryClient();

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  // effect 立即执行；ref 在同一用例的多次“渲染”之间保持。
  useEffect: (effect: () => void) => effect(),
  useRef: () => capture.ref,
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQuery: (options: QueryOptions) => {
    capture.query = options;
    return capture.result;
  },
  useMutation: (options: MutationOptions) => {
    capture.mutation = options;
    return {};
  },
  useQueryClient: () => client,
}));
vi.mock('./auth/auth-context', () => ({
  useAuth: () => ({ request: capture.request, session: capture.session }),
}));

beforeEach(() => {
  client.clear();
  capture.request.mockReset();
  capture.query = null;
  capture.mutation = null;
  capture.result = {};
  capture.ref = { current: undefined };
  capture.session = { mustChangePassword: false };
});

/** 取得最新注册的查询配置。
 * @returns 查询参数。
 * @throws Error 没有注册查询。
 */
function query(): QueryOptions {
  if (!capture.query) throw new Error('No query registered');
  return capture.query;
}
/** 取得最新注册的变更配置。
 * @returns mutation 参数。
 * @throws Error 没有注册变更。
 */
function mutation(): MutationOptions {
  if (!capture.mutation) throw new Error('No mutation registered');
  return capture.mutation;
}
/** 按给定数据计算最新查询的轮询间隔。
 * @param data 模拟的查询数据。
 * @returns 间隔毫秒或 false。
 * @throws Error 没有轮询策略。
 */
function interval(data: unknown): number | false {
  const policy = query().refetchInterval;
  if (typeof policy === 'function') return policy({ state: { data } });
  if (policy === undefined) throw new Error('Missing polling policy');
  return policy;
}
/** 判断缓存项是否已被标记失效。
 * @param key 查询键。
 * @returns 是否失效。
 * @throws 不适用。
 */
function invalidated(key: readonly unknown[]): boolean | undefined {
  return client.getQueryState(key)?.isInvalidated;
}

describe('query layer behavior', () => {
  it('archives through the session client with a 204 parser and encoded IDs', async () => {
    capture.request.mockResolvedValue(undefined);
    useArchiveInstance();
    await mutation().mutationFn('a/b');
    useArchiveJob();
    await mutation().mutationFn('job');
    expect(capture.request.mock.calls).toEqual([
      ['/instances/a%2Fb', { method: 'DELETE', parse: parseEmpty }],
      ['/jobs/job', { method: 'DELETE', parse: parseEmpty }],
    ]);
  });

  it.each([
    ['patch', () => usePatchJob('job')],
    ['toggle', () => useToggleJob()],
  ])(
    'stores the %s result and invalidates every job catalog and the schedule preview',
    (_name, hook) => {
      const keys = [
        jobKeys.catalog(false),
        jobKeys.catalog(true),
        jobKeys.nextFire('job'),
      ];
      for (const key of keys) client.setQueryData(key, []);
      hook();
      mutation().onSuccess?.({ id: 'job', name: 'Updated' });
      for (const key of keys) expect(invalidated(key)).toBe(true);
      expect(client.getQueryData(jobKeys.detail('job'))).toEqual({
        id: 'job',
        name: 'Updated',
      });
    },
  );

  it('refreshes instance state after a connection test even when it fails', () => {
    client.setQueryData(['instances', 'catalog'], []);
    client.setQueryData(['instances', 'detail', 'i1'], {});
    useInstanceTest();
    mutation().onSettled?.(undefined, new Error('down'), {
      id: 'i1',
      retryAuth: false,
    });
    expect(invalidated(['instances', 'catalog'])).toBe(true);
    expect(invalidated(['instances', 'detail', 'i1'])).toBe(true);
  });

  it('refreshes runs and job summaries after a trigger attempt, including a lost response', () => {
    client.setQueryData(runKeys.active, []);
    client.setQueryData(runKeys.list({ page: 1, pageSize: 50 }), {});
    client.setQueryData(jobKeys.catalog(false), []);
    useTriggerRun();
    mutation().onSettled?.(undefined, new Error('NETWORK_ERROR'), {
      jobId: 'job',
      dryRun: false,
      confirmDeletes: false,
    });
    expect(invalidated(runKeys.active)).toBe(true);
    expect(invalidated(runKeys.list({ page: 1, pageSize: 50 }))).toBe(true);
    expect(invalidated(jobKeys.catalog(false))).toBe(true);
  });

  it('loads complete catalogs across pages, de-duplicating shifted rows and forwarding cancellation', async () => {
    capture.request
      .mockResolvedValueOnce({
        items: [{ id: 'first' }, { id: 'shifted' }],
        page: 1,
        pageSize: 200,
        total: 201,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'shifted' }, { id: 'last' }],
        page: 2,
        pageSize: 200,
        total: 201,
      });
    const signal = new AbortController().signal;
    useInstanceCatalog();
    expect(await query().queryFn({ signal })).toEqual([
      { id: 'first' },
      { id: 'shifted' },
      { id: 'last' },
    ]);
    expect(capture.request.mock.calls.map(([path]) => path)).toEqual([
      '/instances?page=1&pageSize=200',
      '/instances?page=2&pageSize=200',
    ]);
    expect(
      capture.request.mock.calls.every(
        ([, options]) => options.signal === signal,
      ),
    ).toBe(true);
  });

  it('posts only retry options and refreshes parent eligibility after a lost response', async () => {
    const keys = [
      runKeys.detail('parent/id'),
      runKeys.active,
      runKeys.list({ page: 1, pageSize: 50 }),
      jobKeys.catalog(false),
    ];
    for (const key of keys) client.setQueryData(key, {});
    useRetryRun();
    await mutation().mutationFn({ id: 'parent/id', confirmDeletes: false });
    expect(capture.request).toHaveBeenCalledWith('/runs/parent%2Fid/retry', {
      method: 'POST',
      body: { confirmDeletes: false },
      parse: expect.any(Function),
    });
    await mutation().onSettled?.(undefined, new Error('NETWORK_ERROR'));
    for (const key of keys) expect(invalidated(key)).toBe(true);
  });

  it('requests archived jobs only when asked and polls only for the owning page', async () => {
    capture.request.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 200,
      total: 0,
    });
    useJobCatalog({ includeArchived: true, poll: true });
    await query().queryFn({ signal: new AbortController().signal });
    expect(capture.request.mock.calls[0][0]).toBe(
      '/jobs?page=1&pageSize=200&includeArchived=true',
    );
    expect(query().refetchInterval).toBe(30_000);
    useJobCatalog();
    expect(query().refetchInterval).toBe(false);
  });

  it('discovers active runs every 15s when idle, 5s while running, and only from the owner', async () => {
    capture.request.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 200,
      total: 0,
    });
    useActiveRuns({ poll: true });
    await query().queryFn({ signal: new AbortController().signal });
    expect(capture.request.mock.calls[0][0]).toBe(
      '/runs?status=active&page=1&pageSize=200',
    );
    expect(interval([])).toBe(15_000);
    expect(interval([{ id: 'run' }])).toBe(5_000);
    useActiveRuns();
    expect(query().refetchInterval).toBe(false);
    expect(query().enabled).toBe(false);
    capture.session = { mustChangePassword: true };
    useActiveRuns({ poll: true });
    expect(query().enabled).toBe(false);
  });

  it('leaves desktop and mobile health readers passive under one shell owner', () => {
    useHealth(true);
    expect(query().enabled).toBe(true);
    expect(interval(undefined)).toBe(30_000);
    useHealth();
    expect(query().enabled).toBe(false);
    expect(interval(undefined)).toBe(false);
  });

  it('waits for the trigger activity refresh before enabling another submission', async () => {
    client.setQueryData(runKeys.active, []);
    let resolve: (value: unknown[]) => void = () => {};
    const observer = new QueryObserver(client, {
      queryKey: runKeys.active,
      staleTime: Infinity,
      queryFn: () =>
        new Promise<unknown[]>((done) => {
          resolve = done;
        }),
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      useTriggerRun();
      let settled = false;
      const refresh = Promise.resolve(
        mutation().onSettled?.(undefined, new Error('NETWORK_ERROR')),
      ).then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      resolve([{ id: 'accepted' }]);
      await refresh;
      expect(client.getQueryData(runKeys.active)).toEqual([{ id: 'accepted' }]);
    } finally {
      unsubscribe();
    }
  });

  it('refreshes summaries after cancellation even when the shell never observed the queued run', () => {
    client.setQueryData(jobKeys.catalog(false), []);
    const children = runKeys.operations('quick-run', { page: 1, pageSize: 50 });
    client.setQueryData(children, { items: [] });
    useCancelRun();
    mutation().onSettled?.(undefined, null, 'quick-run');
    expect(invalidated(jobKeys.catalog(false))).toBe(true);
    expect(invalidated(children)).toBe(false);
  });

  it('refreshes cached children on the first terminal observation, once per run', () => {
    const children = runKeys.operations('finished', { page: 1, pageSize: 50 });
    client.setQueryData(children, { items: [{ status: 'running' }] });
    capture.result = { data: { status: 'succeeded' } };
    useRun('finished');
    expect(invalidated(children)).toBe(true);
    client.setQueryData(children, { items: [{ status: 'succeeded' }] });
    useRun('finished');
    expect(invalidated(children)).toBe(false);
    const another = runKeys.issues('another', { page: 1, pageSize: 50 });
    client.setQueryData(another, { items: [] });
    useRun('another');
    expect(invalidated(another)).toBe(true);
  });

  it('keeps discovering new operations on the first page without polling terminal history pages', () => {
    useOperations({ page: 1, pageSize: 50 });
    expect(interval({ items: [] })).toBe(15_000);
    expect(interval({ items: [{ status: 'running' }] })).toBe(5_000);
    useOperations({ page: 2, pageSize: 50 });
    expect(interval({ items: [{ status: 'unknown' }] })).toBe(false);
  });

  it('refreshes summaries and the finished run when an active run disappears', () => {
    client.setQueryData(jobKeys.catalog(false), []);
    client.setQueryData(runKeys.list({ page: 1, pageSize: 50 }), {});
    client.setQueryData(runKeys.detail('done'), {});
    client.setQueryData(runKeys.detail('still'), {});
    capture.result = {
      data: [{ id: 'done' }, { id: 'still' }],
      dataUpdatedAt: 1,
    };
    useActiveRunsOwner();
    // 第一次观察只建立基线，不触发刷新。
    expect(invalidated(jobKeys.catalog(false))).toBe(false);
    capture.result = { data: [{ id: 'still' }], dataUpdatedAt: 2 };
    useActiveRunsOwner();
    expect(invalidated(jobKeys.catalog(false))).toBe(true);
    expect(invalidated(runKeys.list({ page: 1, pageSize: 50 }))).toBe(true);
    expect(invalidated(runKeys.detail('done'))).toBe(true);
    expect(invalidated(runKeys.detail('still'))).toBe(false);
  });

  it('ignores failed active-run refreshes instead of treating jobs as idle', () => {
    client.setQueryData(jobKeys.catalog(false), []);
    capture.result = { data: [{ id: 'run' }], dataUpdatedAt: 1 };
    useActiveRunsOwner();
    capture.result = { data: undefined, dataUpdatedAt: 1, isError: true };
    useActiveRunsOwner();
    expect(invalidated(jobKeys.catalog(false))).toBe(false);
  });

  it('polls the first runs page while idle but later pages only while they show active runs', () => {
    useRuns({ page: 1, pageSize: 50 });
    expect(interval({ items: [{ status: 'succeeded' }] })).toBe(15_000);
    expect(interval({ items: [{ status: 'recovering' }] })).toBe(5_000);
    useRuns({ page: 2, pageSize: 50 });
    expect(interval({ items: [{ status: 'partial' }] })).toBe(false);
    expect(interval({ items: [{ status: 'queued' }] })).toBe(5_000);
  });

  it('polls child tables only while the run is active, with the same cache key either way', () => {
    for (const hook of [useRunOperations, useRunIssues]) {
      hook('run', { page: 1, pageSize: 25 }, true);
      const active = query();
      expect(active.refetchInterval).toBe(5_000);
      hook('run', { page: 1, pageSize: 25 }, false);
      expect(query().refetchInterval).toBe(false);
      expect(query().queryKey).toEqual(active.queryKey);
    }
  });

  it('refreshes busy retry eligibility even on terminal runs and stops once the job is idle', () => {
    useRun('parent');
    expect(
      interval({
        status: 'partial',
        retryEligibility: { eligible: false, reason: 'JOB_BUSY' },
      }),
    ).toBe(5_000);
    expect(
      interval({
        status: 'partial',
        retryEligibility: { eligible: true, reason: null },
      }),
    ).toBe(false);
    expect(
      interval({
        status: 'partial',
        retryEligibility: { eligible: false, reason: 'RUN_SUPERSEDED' },
      }),
    ).toBe(false);
  });

  it('refreshes visible child tables once when the run reaches a terminal state', () => {
    const operations = runKeys.operations('run', { page: 1, pageSize: 50 });
    const issues = runKeys.issues('run', { page: 1, pageSize: 25 });
    client.setQueryData(runKeys.detail('run'), {});
    client.setQueryData(operations, {});
    client.setQueryData(issues, {});
    capture.result = { data: { status: 'executing' } };
    useRun('run');
    expect(interval({ status: 'executing' })).toBe(5_000);
    expect(invalidated(operations)).toBe(false);
    capture.result = { data: { status: 'succeeded' } };
    useRun('run');
    expect(
      interval({ status: 'succeeded', retryEligibility: { reason: null } }),
    ).toBe(false);
    expect(invalidated(operations)).toBe(true);
    expect(invalidated(issues)).toBe(true);
    // 详情本身已是最新终态，不再重复失效。
    expect(invalidated(runKeys.detail('run'))).toBe(false);
  });
});
