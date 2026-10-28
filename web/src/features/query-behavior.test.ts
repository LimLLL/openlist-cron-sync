// 使用真实 QueryClient 验证跨页面失效与轮询策略；只替换 React hooks 的挂载边界。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { parseEmpty } from '../lib/parsers';
import {
  useArchiveInstance,
  useInstanceTest,
} from './instances/instance-queries';
import {
  useArchiveJob,
  useInstanceOptions,
  usePatchJob,
  useToggleJob,
} from './jobs/job-queries';
import {
  useJobNames,
  useRunIssues,
  useRunOperations,
  useRuns,
} from './runs/run-queries';

/** 需要捕获的查询 hook 参数。 */
interface QueryOptions {
  /** 缓存标识。 */
  queryKey: readonly unknown[];
  /** 接受真实取消信号的请求。 */
  queryFn: (context: { signal: AbortSignal }) => Promise<unknown>;
  /** 固定或动态轮询间隔。 */
  refetchInterval?:
    | number
    | false
    | ((query: {
        state: { data?: { items: { status: string }[] } };
      }) => number | false);
}
/** 测试调用的 mutation 配置。 */
interface MutationOptions {
  /** 输入提交函数。 */
  mutationFn: (value?: unknown) => Promise<unknown>;
  /** 成功后的缓存处理。 */
  onSuccess: (data: unknown, variables?: unknown) => void;
}
const capture = vi.hoisted(() => ({
  query: null as QueryOptions | null,
  mutation: null as MutationOptions | null,
  request: vi.fn(),
  navigate: vi.fn(),
}));
const client = new QueryClient();

vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQuery: (options: QueryOptions) => {
    capture.query = options;
    return {};
  },
  useMutation: (options: MutationOptions) => {
    capture.mutation = options;
    return {};
  },
  useQueryClient: () => client,
}));
vi.mock('./auth/auth-context', () => ({
  useAuth: () => ({ request: capture.request }),
}));
vi.mock('react-router', () => ({ useNavigate: () => capture.navigate }));

/** 每个用例从空缓存开始。
 * @returns 不适用。
 * @throws 不适用。
 */
beforeEach(() => {
  client.clear();
  capture.request.mockReset();
  capture.navigate.mockReset();
  capture.query = null;
  capture.mutation = null;
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

describe('cross-page query behavior', () => {
  it('routes both archive requests through the session client with a 204 parser', async () => {
    capture.request.mockResolvedValue(undefined);
    useArchiveInstance();
    await mutation().mutationFn('instance');
    useArchiveJob('job');
    await mutation().mutationFn();
    expect(capture.request.mock.calls).toEqual([
      ['/instances/instance', { method: 'DELETE', parse: parseEmpty }],
      ['/jobs/job', { method: 'DELETE', parse: parseEmpty }],
    ]);
  });
  it.each([usePatchJob, useToggleJob])(
    'invalidates schedule and dashboard data after a job changes',
    (hook) => {
      const keys = [
        ['jobs', 'job', 'next-fire-times'],
        ['jobs', 'list', 1, 20],
        ['dashboard', 'jobs'],
        ['dashboard', 'next-fire-times', 'job'],
      ];
      for (const key of keys) client.setQueryData(key, {});
      hook('job');
      mutation().onSuccess({ id: 'job' });
      for (const key of keys)
        expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    },
  );
  it('invalidates the instance list and dashboard after a connection test', () => {
    client.setQueryData(['instances', { page: 1, pageSize: 20 }], {});
    client.setQueryData(['dashboard', 'instances'], {});
    useInstanceTest('instance');
    mutation().onSuccess({});
    expect(
      client.getQueryState(['instances', { page: 1, pageSize: 20 }])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(['dashboard', 'instances'])?.isInvalidated,
    ).toBe(true);
  });
  it('loads picker options beyond the first 200 instances and forwards cancellation', async () => {
    capture.request
      .mockResolvedValueOnce({
        items: [{ id: 'first' }],
        page: 1,
        pageSize: 200,
        total: 201,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'last' }],
        page: 2,
        pageSize: 200,
        total: 201,
      });
    const signal = new AbortController().signal;
    useInstanceOptions();
    expect(await query().queryFn({ signal })).toEqual([
      { id: 'first' },
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
  it('loads job names across all pages, including archived jobs', async () => {
    capture.request
      .mockResolvedValueOnce({
        items: [{ id: 'job-1', name: 'First' }],
        page: 1,
        pageSize: 200,
        total: 201,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'job-2', name: 'Archived' }],
        page: 2,
        pageSize: 200,
        total: 201,
      });
    useJobNames();
    const page = (await query().queryFn({
      signal: new AbortController().signal,
    })) as {
      items: { id: string; name: string }[];
    };
    expect(page.items).toEqual([
      { id: 'job-1', name: 'First' },
      { id: 'job-2', name: 'Archived' },
    ]);
    expect(capture.request.mock.calls.map(([path]) => path)).toEqual([
      '/jobs?page=1&pageSize=200&includeArchived=true',
      '/jobs?page=2&pageSize=200&includeArchived=true',
    ]);
  });
  it('refreshes child tables once at terminal transition and stops polling', () => {
    for (const hook of [useRunOperations, useRunIssues]) {
      hook('run', { page: 1, pageSize: 25 }, 'executing');
      const active = query();
      expect(active.refetchInterval).toBe(2500);
      hook('run', { page: 1, pageSize: 25 }, 'succeeded');
      expect(query().refetchInterval).toBe(false);
      expect(query().queryKey).not.toEqual(active.queryKey);
    }
  });
  it('polls lists with active runs but stops for terminal-only results', () => {
    useRuns({ page: 1, pageSize: 20 });
    const interval = query().refetchInterval;
    if (typeof interval !== 'function')
      throw new Error('Missing polling policy');
    expect(
      interval({ state: { data: { items: [{ status: 'recovering' }] } } }),
    ).toBe(2500);
    expect(
      interval({ state: { data: { items: [{ status: 'partial' }] } } }),
    ).toBe(false);
  });
});
