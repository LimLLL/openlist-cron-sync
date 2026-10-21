// 运行数据查询与变更 hooks，活动 Run 自动轮询。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import type { RunStatus } from './run-contract';
import {
  ACTIVE_RUN_STATUSES,
  parseRunDetail,
  parseRunPage,
  parseRunView,
  parseIssuePage,
  parseJobNamePage,
} from './run-contract';
import { parseOperationPage } from '../operations/operation-contract';
import type { Page } from '../../lib/parsers';
import type { JobName } from './run-contract';

/** 查询 Run 分页列表。
 * @param params 分页和过滤参数。
 * @returns TanStack Query 结果。
 * @throws 不适用；错误通过 Query 状态暴露。
 */
export function useRuns(params: {
  page: number;
  pageSize: number;
  jobId?: string;
  status?: string;
  dryRun?: string;
}) {
  const { request } = useAuth();
  const search = new URLSearchParams();
  search.set('page', String(params.page));
  search.set('pageSize', String(params.pageSize));
  if (params.jobId) search.set('jobId', params.jobId);
  if (params.status) search.set('status', params.status);
  if (params.dryRun) search.set('dryRun', params.dryRun);
  const query = search.toString();
  return useQuery({
    queryKey: ['runs', query],
    queryFn: ({ signal }) =>
      request(`/runs?${query}`, { signal, parse: parseRunPage }),
    refetchInterval: (query) =>
      query.state.data?.items.some((run) => ACTIVE_RUN_STATUSES.has(run.status))
        ? 2500
        : false,
  });
}

/** 读取任务名称映射（含已归档任务，历史运行仍能显示名称）。
 * @returns TanStack Query 结果，data 为 id 到名称的 Map。
 * @throws 不适用；错误通过 Query 状态暴露，列表回退显示任务 ID。
 */
export function useJobNames() {
  const { request } = useAuth();
  return useQuery({
    queryKey: ['jobs', 'names'],
    queryFn: async ({ signal }): Promise<Page<JobName>> => {
      const items: JobName[] = [];
      let total = 0;
      let pageSize = 200;
      for (let page = 1; ; page += 1) {
        const result = await request(
          `/jobs?page=${page}&pageSize=200&includeArchived=true`,
          { signal, parse: parseJobNamePage },
        );
        items.push(...result.items);
        total = result.total;
        pageSize = result.pageSize;
        if (page * result.pageSize >= result.total || result.items.length === 0)
          break;
      }
      return { items, page: 1, pageSize, total };
    },
    select: (page) => new Map(page.items.map((job) => [job.id, job.name])),
    staleTime: 60_000,
  });
}

/** 查询 Run 详情，活动状态自动轮询。
 * @param id Run UUID。
 * @returns TanStack Query 结果。
 * @throws 不适用。
 */
export function useRunDetail(id: string) {
  const { request } = useAuth();
  return useQuery({
    queryKey: ['runs', id],
    queryFn: ({ signal }) =>
      request(`/runs/${id}`, { signal, parse: parseRunDetail }),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ACTIVE_RUN_STATUSES.has(status) ? 2500 : false;
    },
  });
}

/** 查询 Run 下的操作列表。
 * @param runId Run UUID。
 * @param params 分页和过滤。
 * @param status 父运行状态；终态切换刷新最终页并停止轮询。
 * @returns TanStack Query 结果。
 * @throws 不适用。
 */
export function useRunOperations(
  runId: string,
  params: {
    page: number;
    pageSize: number;
    status?: string;
    action?: string;
  },
  status: RunStatus,
) {
  const { request } = useAuth();
  const search = new URLSearchParams();
  search.set('page', String(params.page));
  search.set('pageSize', String(params.pageSize));
  if (params.status) search.set('status', params.status);
  if (params.action) search.set('action', params.action);
  const query = search.toString();
  return useQuery({
    queryKey: ['runs', runId, 'operations', query, status],
    queryFn: ({ signal }) =>
      request(`/runs/${runId}/operations?${query}`, {
        signal,
        parse: parseOperationPage,
      }),
    refetchInterval: ACTIVE_RUN_STATUSES.has(status) ? 2500 : false,
  });
}

/** 查询 Run 下的扫描问题列表。
 * @param runId Run UUID。
 * @param params 分页参数。
 * @param status 父运行状态；终态切换刷新最终页并停止轮询。
 * @returns TanStack Query 结果。
 * @throws 不适用。
 */
export function useRunIssues(
  runId: string,
  params: { page: number; pageSize: number },
  status: RunStatus,
) {
  const { request } = useAuth();
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  const query = search.toString();
  return useQuery({
    queryKey: ['runs', runId, 'issues', query, status],
    queryFn: ({ signal }) =>
      request(`/runs/${runId}/issues?${query}`, {
        signal,
        parse: parseIssuePage,
      }),
    refetchInterval: ACTIVE_RUN_STATUSES.has(status) ? 2500 : false,
  });
}

/** 取消 Run 变更。
 * @returns Mutation hook。
 * @throws 不适用。
 */
export function useCancelRun() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request(`/runs/${id}/cancel`, {
        method: 'POST',
        body: {},
        parse: parseRunView,
      }),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['operations'] });
      void queryClient.invalidateQueries({ queryKey: ['runs', id] });
      void queryClient.invalidateQueries({ queryKey: ['runs'], exact: false });
    },
  });
}
