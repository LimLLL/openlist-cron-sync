// 运行的取数与变更：共享的活动运行查询（由外壳唯一持有轮询）、运行列表、运行详情及其操作/问题子表、取消运行。
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { fetchAllPages, MAX_PAGE_SIZE } from '../../lib/query';
import { parseOperationPage } from '../operations/operation-contract';
import { jobKeys } from '../jobs/job-queries';
import {
  ACTIVE_RUN_STATUSES,
  parseIssuePage,
  parseRunDetail,
  parseRunListPage,
  parseRunView,
} from './run-contract';
import type { RunListItem } from './run-contract';

/** 运行列表筛选与分页。 */
export interface RunListParams {
  /** 页码。 */
  page: number;
  /** 页大小。 */
  pageSize: number;
  /** 只看某个任务。 */
  jobId?: string;
  /** 状态；active 表示全部进行中状态。 */
  status?: string;
  /** 'true' 只看试运行，'false' 只看正式运行。 */
  dryRun?: string;
}

/** 运行操作子表的筛选与分页。 */
export interface RunOperationParams {
  /** 页码。 */
  page: number;
  /** 页大小。 */
  pageSize: number;
  /** 操作状态。 */
  status?: string;
  /** 动作：mkdir / create / delete。 */
  action?: string;
}

/** 运行相关查询键；子表键不含父运行状态，终态时通过失效刷新。 */
export const runKeys = {
  all: ['runs'] as const,
  active: ['runs', 'active'] as const,
  lists: ['runs', 'list'] as const,
  list: (params: RunListParams) => ['runs', 'list', params] as const,
  detail: (id: string) => ['runs', 'detail', id] as const,
  operations: (id: string, params: RunOperationParams) =>
    ['runs', 'detail', id, 'operations', params] as const,
  issues: (id: string, params: { page: number; pageSize: number }) =>
    ['runs', 'detail', id, 'issues', params] as const,
};

/** 判断运行是否处于进行中。
 * @param status 运行状态。
 * @returns 是否进行中（含排队、取消中、恢复中）。
 * @throws 不适用。
 */
export function isActiveRun(status: string | undefined): boolean {
  return status !== undefined && ACTIVE_RUN_STATUSES.has(status);
}

/** 把筛选参数序列化为查询串，省略空值。
 * @param params 参数对象。
 * @returns 查询串（不含问号）。
 * @throws 不适用。
 */
function toQuery(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') search.set(key, String(value));
  return search.toString();
}

/** 读取全部进行中的运行（含试运行）。页面只读缓存；轮询由 useActiveRunsOwner 在外壳唯一持有。
 * @param options poll 是否由本调用持有轮询：有活动运行时 5 秒，没有时 15 秒（用于发现定时触发的新运行）。
 * @returns 活动运行数组查询。
 * @throws 不适用。
 */
export function useActiveRuns({ poll = false }: { poll?: boolean } = {}) {
  const { request, session } = useAuth();
  return useQuery({
    queryKey: runKeys.active,
    queryFn: ({ signal }) =>
      fetchAllPages((page) =>
        request(`/runs?status=active&page=${page}&pageSize=${MAX_PAGE_SIZE}`, {
          signal,
          parse: parseRunListPage,
        }),
      ),
    // 强制改密期间除改密外的接口都会返回 403，外壳此时不请求。
    enabled: Boolean(poll && session && !session.mustChangePassword),
    refetchInterval: poll
      ? (query) => (query.state.data?.length ? 5_000 : 15_000)
      : false,
    staleTime: 4_000,
  });
}

/** 外壳调用一次：持有活动运行轮询，并在运行开始或结束时刷新任务摘要与运行列表。
 * @returns 活动运行查询。
 * @throws 不适用。
 */
export function useActiveRunsOwner() {
  const queryClient = useQueryClient();
  const query = useActiveRuns({ poll: true });
  const previous = useRef<Set<string> | null>(null);
  const { data, dataUpdatedAt } = query;

  useEffect(() => {
    // 只比较成功的结果；请求失败不代表运行已结束。
    if (!data) return;
    const ids = new Set(data.map((run) => run.id));
    const before = previous.current;
    previous.current = ids;
    if (!before) return;
    const ended = [...before].filter((id) => !ids.has(id));
    const started = [...ids].some((id) => !before.has(id));
    if (ended.length === 0 && !started) return;
    void queryClient.invalidateQueries({ queryKey: runKeys.lists });
    void queryClient.invalidateQueries({ queryKey: jobKeys.catalogs });
    // 结束的运行：详情及其子表重新读取终态数据；未挂载的只标记过期。
    for (const id of ended) {
      void queryClient.invalidateQueries({
        queryKey: runKeys.detail(id),
        exact: true,
      });
      // 可见子表等待父详情拿到终态后统一刷新，避免两个观察者重复发起最终请求。
      void queryClient.invalidateQueries({
        queryKey: runKeys.detail(id),
        predicate: (child) => child.queryKey.length > 3,
        refetchType: 'none',
      });
    }
  }, [data, dataUpdatedAt, queryClient]);

  return query;
}

/** 按任务分组活动运行，供任务列表、概览等叠加“运行中”状态。
 * @param runs 活动运行。
 * @returns 任务 ID 到其活动运行的映射（每个任务至多一个）。
 * @throws 不适用。
 */
export function activeRunsByJob(
  runs: readonly RunListItem[] | undefined,
): Map<string, RunListItem> {
  return new Map((runs ?? []).map((run) => [run.jobId, run]));
}

/** 读取一页运行列表。第一页每 15 秒刷新、含进行中运行时 5 秒；后续页只在含进行中运行时刷新。
 * @param params 筛选与分页。
 * @returns 运行列表查询。
 * @throws 不适用。
 */
export function useRuns(params: RunListParams) {
  const { request } = useAuth();
  const query = toQuery(params);
  return useQuery({
    queryKey: runKeys.list(params),
    queryFn: ({ signal }) =>
      request(`/runs?${query}`, { signal, parse: parseRunListPage }),
    refetchInterval: (current) => {
      const active = current.state.data?.items.some((run) =>
        isActiveRun(run.status),
      );
      if (active) return 5_000;
      return params.page === 1 ? 15_000 : false;
    },
  });
}

/** 读取运行详情；进行中或重试资格因 Job 忙碌被阻断时每 5 秒刷新，终态子表只刷新一次。
 * @param id 运行 ID。
 * @returns 运行详情查询。
 * @throws 不适用。
 */
export function useRun(id: string) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: runKeys.detail(id),
    queryFn: ({ signal }) =>
      request(`/runs/${encodeURIComponent(id)}`, {
        signal,
        parse: parseRunDetail,
      }),
    refetchInterval: (current) =>
      isActiveRun(current.state.data?.status) ||
      current.state.data?.retryEligibility.reason === 'JOB_BUSY'
        ? 5_000
        : false,
  });
  const status = query.data?.status;
  const previous = useRef<{ id: string; status: string } | null>(null);

  useEffect(() => {
    const before = previous.current;
    if (status === undefined) return;
    previous.current = { id, status };
    if (
      isActiveRun(status) ||
      (before?.id === id && !isActiveRun(before.status))
    )
      return;
    // 首次看到终态也刷新：子表可能仍缓存着上次离开页面时的活动数据。
    void queryClient.invalidateQueries({
      queryKey: runKeys.detail(id),
      predicate: (child) => child.queryKey.length > 3,
    });
    void queryClient.invalidateQueries({ queryKey: jobKeys.catalogs });
    void queryClient.invalidateQueries({ queryKey: runKeys.lists });
  }, [id, queryClient, status]);

  return query;
}

/** 读取运行的一页操作；仅当所在标签页挂载时请求，运行进行中每 5 秒刷新。
 * @param runId 运行 ID。
 * @param params 筛选与分页。
 * @param runActive 父运行是否进行中。
 * @returns 操作分页查询。
 * @throws 不适用。
 */
export function useRunOperations(
  runId: string,
  params: RunOperationParams,
  runActive: boolean,
) {
  const { request } = useAuth();
  return useQuery({
    queryKey: runKeys.operations(runId, params),
    queryFn: ({ signal }) =>
      request(
        `/runs/${encodeURIComponent(runId)}/operations?${toQuery(params)}`,
        { signal, parse: parseOperationPage },
      ),
    refetchInterval: runActive ? 5_000 : false,
  });
}

/** 读取运行的一页扫描问题；仅当所在标签页挂载时请求，运行进行中每 5 秒刷新。
 * @param runId 运行 ID。
 * @param params 分页。
 * @param runActive 父运行是否进行中。
 * @returns 问题分页查询。
 * @throws 不适用。
 */
export function useRunIssues(
  runId: string,
  params: { page: number; pageSize: number },
  runActive: boolean,
) {
  const { request } = useAuth();
  return useQuery({
    queryKey: runKeys.issues(runId, params),
    queryFn: ({ signal }) =>
      request(`/runs/${encodeURIComponent(runId)}/issues?${toQuery(params)}`, {
        signal,
        parse: parseIssuePage,
      }),
    refetchInterval: runActive ? 5_000 : false,
  });
}

/** 请求取消运行；取消请求不等于已取消，运行会经过“取消中”再进入终态。
 * @returns 变更对象，变量为运行 ID。
 * @throws 不适用。
 */
export function useCancelRun() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request(`/runs/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        body: {},
        parse: parseRunView,
      }),
    onSettled: (_data, _error, id) => {
      // 子表继续按父状态轮询，并由详情观察者统一刷新最终结果。
      void queryClient.invalidateQueries({
        queryKey: runKeys.detail(id),
        exact: true,
      });
      void queryClient.invalidateQueries({ queryKey: runKeys.active });
      void queryClient.invalidateQueries({ queryKey: runKeys.lists });
      void queryClient.invalidateQueries({ queryKey: jobKeys.catalogs });
    },
  });
}

/** 重试一次运行中未成功的项目，返回新建的重试运行；不自动重放（没有幂等键）。
 * @returns 变更对象，变量为 { id: 来源运行 ID, confirmDeletes }。
 * @throws 不适用。
 */
export function useRetryRun() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      confirmDeletes,
    }: {
      id: string;
      confirmDeletes: boolean;
    }) =>
      request(`/runs/${encodeURIComponent(id)}/retry`, {
        method: 'POST',
        body: { confirmDeletes },
        parse: parseRunView,
      }),
    onSettled: async () => {
      // 失败也刷新：被拒绝时来源详情会给出最新的不可重试原因，网络错误时运行可能已被接受。
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: runKeys.all }),
        queryClient.invalidateQueries({ queryKey: jobKeys.catalogs }),
      ]);
    },
  });
}
