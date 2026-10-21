// TanStack Query hooks 封装 Job API 请求与缓存策略。
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import {
  parseJob,
  parseJobPage,
  parseNextFireTimes,
  parseTriggerResult,
} from './job-contract';
import { parseEmpty } from '../../lib/parsers';
import { parseInstancePage } from '../instances/instance-contract';
import type { Instance } from '../instances/instance-contract';
import type { JobView } from './job-contract';

/** Job 列表缓存键前缀。 */
const JOBS_KEY = ['jobs'] as const;

/** 分页查询 Job 列表。
 * @param page 页号。
 * @param pageSize 页大小。
 * @returns 分页查询结果。
 * @throws 不适用；错误通过 Query 状态返回。
 */
export function useJobs(page: number, pageSize: number) {
  const { request } = useAuth();
  return useQuery({
    queryKey: [...JOBS_KEY, 'list', page, pageSize],
    queryFn: ({ signal }) =>
      request(`/jobs?page=${page}&pageSize=${pageSize}`, {
        signal,
        parse: parseJobPage,
      }),
  });
}

/** 查询单个 Job。
 * @param id Job UUID。
 * @returns 查询结果。
 * @throws 不适用。
 */
export function useJob(id: string) {
  const { request } = useAuth();
  return useQuery({
    queryKey: [...JOBS_KEY, id],
    queryFn: ({ signal }) =>
      request(`/jobs/${id}` as `/${string}`, { signal, parse: parseJob }),
  });
}

/** 查询下次触发时间。
 * @param id Job UUID。
 * @param enabled 是否启用查询（仅当 Job 有 cron 且已启用）。
 * @returns 查询结果。
 * @throws 不适用。
 */
export function useNextFireTimes(id: string, enabled: boolean) {
  const { request } = useAuth();
  return useQuery({
    queryKey: [...JOBS_KEY, id, 'next-fire-times'],
    queryFn: ({ signal }) =>
      request(`/jobs/${id}/next-fire-times?count=5` as `/${string}`, {
        signal,
        parse: parseNextFireTimes,
      }),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

/** 创建 Job。
 * @returns Mutation 结果。
 * @throws 不适用。
 */
export function useCreateJob() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: object) =>
      request('/jobs', { method: 'POST', body, parse: parseJob }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

/** 更新 Job。
 * @param id Job UUID。
 * @returns Mutation 结果。
 * @throws 不适用。
 */
export function usePatchJob(id: string) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: object) =>
      request(`/jobs/${id}` as `/${string}`, {
        method: 'PATCH',
        body,
        parse: parseJob,
      }),
    onSuccess: (data: JobView) => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.setQueryData([...JOBS_KEY, id], data);
      void queryClient.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

/** 归档 Job。
 * @param id Job UUID。
 * @returns Mutation 结果。
 * @throws 不适用。
 */
export function useArchiveJob(id: string) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await request(`/jobs/${id}` as `/${string}`, {
        method: 'DELETE',
        parse: parseEmpty,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

/** 启用/禁用 Job。
 * @param id Job UUID。
 * @returns Mutation 结果。
 * @throws 不适用。
 */
export function useToggleJob(id: string) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enable: boolean) =>
      request(`/jobs/${id}/${enable ? 'enable' : 'disable'}` as `/${string}`, {
        method: 'POST',
        body: {},
        parse: parseJob,
      }),
    onSuccess: (data: JobView) => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.setQueryData([...JOBS_KEY, id], data);
      void queryClient.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

/** 触发 Job 执行。
 * @param id Job UUID。
 * @returns Mutation 结果。
 * @throws 不适用。
 */
export function useTriggerRun(id: string) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { dryRun?: boolean; confirmDeletes?: boolean }) =>
      request(`/jobs/${id}/runs` as `/${string}`, {
        method: 'POST',
        body,
        parse: parseTriggerResult,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}

/** 获取实例列表用于 Job 表单选择。
 * @returns 分页查询结果。
 * @throws 不适用。
 */
export function useInstanceOptions() {
  const { request } = useAuth();
  return useQuery({
    queryKey: ['instances', 'options'],
    queryFn: async ({ signal }) => {
      const items: Instance[] = [];
      for (let page = 1; ; page++) {
        const result = await request(`/instances?page=${page}&pageSize=200`, {
          signal,
          parse: parseInstancePage,
        });
        items.push(...result.items);
        if (page * result.pageSize >= result.total || result.items.length === 0)
          return items;
      }
    },
    staleTime: 30_000,
  });
}
