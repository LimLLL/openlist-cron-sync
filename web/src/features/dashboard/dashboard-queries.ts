// TanStack Query hooks 汇聚多个端点，为面板各区域提供数据。
import { useQueries, useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';
import { useAuth } from '../auth/auth-context';
import {
  parseDashboardRunPage,
  parseDashboardInstancePage,
  parseDashboardJobPage,
  parseNextFireTimes,
  parseHealth,
} from './dashboard-contract';
import type {
  DashboardRun,
  DashboardInstance,
  DashboardJob,
  NextFireTimes,
  HealthView,
} from './dashboard-contract';
import type { Page } from '../../lib/parsers';

/** 近期 Run（含所有状态），10 秒轮询。
 * @returns TanStack Query 结果。
 * @throws 不适用。
 */
export function useRecentRuns() {
  const { request } = useAuth();
  return useQuery<Page<DashboardRun>>({
    queryKey: ['dashboard', 'recent-runs'],
    queryFn: ({ signal }) =>
      request('/runs', { signal, parse: parseDashboardRunPage, method: 'GET' }),
    refetchInterval: 10_000,
  });
}

const ACTIVE_STATUSES = [
  'queued',
  'scanning',
  'planned',
  'executing',
  'cancelling',
  'recovering',
] as const;

/** 活跃 Run（非终态），2.5 秒轮询；合并跨状态请求中的重复记录。
 * @returns TanStack Query 结果。
 * @throws 不适用。
 */
export function useActiveRuns() {
  const { request } = useAuth();
  return useQueries({
    queries: ACTIVE_STATUSES.map((status) => ({
      queryKey: ['dashboard', 'active-runs', status],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        request(`/runs?status=${status}&pageSize=20`, {
          signal,
          parse: parseDashboardRunPage,
        }),
      refetchInterval: 2500,
    })),
    combine(results) {
      const runs = new Map<string, DashboardRun>();
      let total = 0;
      let isPending = false;
      let isError = false;
      for (const r of results) {
        if (r.isPending) isPending = true;
        if (r.isError) isError = true;
        if (r.data) {
          total += r.data.total;
          for (const run of r.data.items) {
            const previous = runs.get(run.id);
            if (!previous || run.updatedAt >= previous.updatedAt)
              runs.set(run.id, run);
          }
        }
      }
      const data = [...runs.values()].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return {
        data,
        total,
        isPending,
        isError,
        error: results.find((result) => result.isError)?.error ?? null,
      };
    },
  });
}

/** 前 200 个 Instance（面板明确显示范围），30 秒轮询。
 * @returns TanStack Query 结果。
 * @throws 不适用。
 */
export function useAllInstances() {
  const { request } = useAuth();
  return useQuery<Page<DashboardInstance>>({
    queryKey: ['dashboard', 'instances'],
    queryFn: ({ signal }) =>
      request('/instances?pageSize=200', {
        signal,
        parse: parseDashboardInstancePage,
      }),
    refetchInterval: 30_000,
  });
}

/** 前 200 个 Job（面板明确显示范围），30 秒轮询。
 * @returns TanStack Query 结果。
 * @throws 不适用。
 */
export function useAllJobs() {
  const { request } = useAuth();
  return useQuery<Page<DashboardJob>>({
    queryKey: ['dashboard', 'jobs'],
    queryFn: ({ signal }) =>
      request('/jobs?pageSize=200', { signal, parse: parseDashboardJobPage }),
    refetchInterval: 30_000,
  });
}

/** 按 Job ID 查询下次执行时刻。
 * @param jobIds 启用了 cron 的 Job UUID 列表。
 * @returns 按 Job UUID 索引的下次执行时刻。
 * @throws 不适用。
 */
export function useNextFireTimes(jobIds: string[]) {
  const { request } = useAuth();
  return useQueries({
    queries: jobIds.map((jobId) => ({
      queryKey: ['dashboard', 'next-fire-times', jobId],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        request(`/jobs/${jobId}/next-fire-times?count=3`, {
          signal,
          parse: parseNextFireTimes,
        }),
      staleTime: 60_000,
      refetchInterval: 60_000,
      enabled: jobIds.length > 0,
    })),
    combine(results) {
      const map = new Map<string, NextFireTimes>();
      for (let i = 0; i < jobIds.length; i++) {
        const r = results[i];
        if (r?.data) map.set(jobIds[i], r.data);
      }
      return {
        data: map,
        isPending: results.some((r) => r.isPending),
        error: results.find((r) => r.isError)?.error ?? null,
      };
    },
  });
}

/** 系统健康，公开端点无需 token，15 秒轮询。
 * @returns TanStack Query 结果。
 * @throws 不适用。
 */
export function useHealth() {
  return useQuery<HealthView>({
    queryKey: ['dashboard', 'health'],
    queryFn: ({ signal }) =>
      apiRequest('/system/health/ready', {
        signal,
        acceptedStatuses: [503],
        parse: parseHealth,
      }),
    refetchInterval: 15_000,
  });
}
