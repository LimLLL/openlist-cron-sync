// 任务的取数与变更：完整任务目录（含最近一次正式运行与下次定时）、单个任务配置、定时预览，以及创建/修改/归档/启停/触发运行。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { fetchAllPages, MAX_PAGE_SIZE } from '../../lib/query';
import { parseEmpty } from '../../lib/parsers';
import {
  parseJob,
  parseJobListPage,
  parseNextFireTimes,
  parseTriggerResult,
} from './job-contract';
import type { JobView } from './job-contract';

/** 任务相关查询键；前缀失效即可刷新同类全部查询。 */
export const jobKeys = {
  all: ['jobs'] as const,
  catalogs: ['jobs', 'catalog'] as const,
  catalog: (includeArchived: boolean) =>
    ['jobs', 'catalog', { includeArchived }] as const,
  detail: (id: string) => ['jobs', 'detail', id] as const,
  nextFire: (id: string) => ['jobs', 'detail', id, 'next-fire'] as const,
};

/** 读取完整任务目录（逐页取完），用于前端搜索、筛选、排序与名称查找。
 * @param options includeArchived 是否包含归档任务；poll 为 true 时每 30 秒刷新（只由当前页面持有）。
 * @returns 任务列表项数组查询。
 * @throws 不适用；任意一页失败时整个查询失败，不返回部分目录。
 */
export function useJobCatalog({
  includeArchived = false,
  poll = false,
}: { includeArchived?: boolean; poll?: boolean } = {}) {
  const { request } = useAuth();
  return useQuery({
    queryKey: jobKeys.catalog(includeArchived),
    queryFn: ({ signal }) =>
      fetchAllPages((page) =>
        request(
          `/jobs?page=${page}&pageSize=${MAX_PAGE_SIZE}${includeArchived ? '&includeArchived=true' : ''}`,
          { signal, parse: parseJobListPage },
        ),
      ),
    refetchInterval: poll ? 30_000 : false,
  });
}

/** 读取单个任务的完整配置；归档任务返回 404。
 * @param id 任务 ID。
 * @returns 任务配置查询。
 * @throws 不适用。
 */
export function useJob(id: string) {
  const { request } = useAuth();
  return useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: ({ signal }) =>
      request(`/jobs/${encodeURIComponent(id)}`, { signal, parse: parseJob }),
  });
}

/** 读取接下来 5 次定时时间，每分钟刷新；仅在任务启用且有 cron 时请求。
 * @param id 任务 ID。
 * @param enabled 是否请求。
 * @returns 定时预览查询。
 * @throws 不适用。
 */
export function useNextFireTimes(id: string, enabled: boolean) {
  const { request } = useAuth();
  return useQuery({
    queryKey: jobKeys.nextFire(id),
    queryFn: ({ signal }) =>
      request(`/jobs/${encodeURIComponent(id)}/next-fire-times?count=5`, {
        signal,
        parse: parseNextFireTimes,
      }),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

/** 创建任务；成功后刷新任务目录。
 * @returns 变更对象，变量为请求体。
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
      void queryClient.invalidateQueries({ queryKey: jobKeys.catalogs });
    },
  });
}

/** 修改任务；成功后写入详情缓存并刷新目录。
 * @param id 任务 ID。
 * @returns 变更对象，变量为 PATCH 请求体。
 * @throws 不适用。
 */
export function usePatchJob(id: string) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: object) =>
      request(`/jobs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body,
        parse: parseJob,
      }),
    onSuccess: (data: JobView) => {
      queryClient.setQueryData(jobKeys.detail(id), data);
      void queryClient.invalidateQueries({ queryKey: jobKeys.catalogs });
      void queryClient.invalidateQueries({ queryKey: jobKeys.nextFire(id) });
    },
  });
}

/** 归档任务（保留运行历史）；成功后移除详情缓存并刷新目录。
 * @returns 变更对象，变量为任务 ID。
 * @throws 不适用。
 */
export function useArchiveJob() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request(`/jobs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        parse: parseEmpty,
      }),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: jobKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: jobKeys.catalogs });
    },
  });
}

/** 启用或停用定时；手动运行不受影响，停用也不会取消正在进行的运行。
 * @returns 变更对象，变量为 { id, enable }。
 * @throws 不适用。
 */
export function useToggleJob() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) =>
      request(
        `/jobs/${encodeURIComponent(id)}/${enable ? 'enable' : 'disable'}`,
        { method: 'POST', body: {}, parse: parseJob },
      ),
    onSuccess: (data: JobView) => {
      queryClient.setQueryData(jobKeys.detail(data.id), data);
      void queryClient.invalidateQueries({ queryKey: jobKeys.catalogs });
      void queryClient.invalidateQueries({
        queryKey: jobKeys.nextFire(data.id),
      });
    },
  });
}

/** 触发一次运行；不自动重试（没有幂等键，网络错误不代表未创建）。成功后刷新活动运行、运行列表与任务目录。
 * @returns 变更对象，变量为 { jobId, dryRun, confirmDeletes }。
 * @throws 不适用。
 */
export function useTriggerRun() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      jobId,
      dryRun,
      confirmDeletes,
    }: {
      jobId: string;
      dryRun: boolean;
      confirmDeletes: boolean;
    }) =>
      request(`/jobs/${encodeURIComponent(jobId)}/runs`, {
        method: 'POST',
        body: { dryRun, confirmDeletes },
        parse: parseTriggerResult,
      }),
    onSettled: async () => {
      // 失败也刷新：网络错误时运行可能已被接受，先让界面反映真实状态再允许重试。
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runs'] }),
        queryClient.invalidateQueries({ queryKey: jobKeys.catalogs }),
      ]);
    },
  });
}
