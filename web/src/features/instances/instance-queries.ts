// 实例的取数与变更：完整实例目录、单个实例、创建/修改/归档、连接测试与目录浏览；从不把连接测试当作轮询。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { fetchAllPages, MAX_PAGE_SIZE } from '../../lib/query';
import { parseEmpty } from '../../lib/parsers';
import {
  parseBrowseResult,
  parseInstance,
  parseInstancePage,
  parseTestResult,
} from './instance-contract';
import type { Instance, InstanceInput } from './instance-contract';

/** 实例相关查询键。 */
export const instanceKeys = {
  all: ['instances'] as const,
  catalog: ['instances', 'catalog'] as const,
  detail: (id: string) => ['instances', 'detail', id] as const,
};

/** 读取完整实例目录（逐页取完），用于列表、名称查找与表单下拉框。
 * @param options poll 为 true 时每 60 秒刷新（只由当前页面持有）。
 * @returns 实例数组查询。
 * @throws 不适用；任意一页失败时整个查询失败。
 */
export function useInstanceCatalog({ poll = false }: { poll?: boolean } = {}) {
  const { request } = useAuth();
  return useQuery({
    queryKey: instanceKeys.catalog,
    queryFn: ({ signal }) =>
      fetchAllPages((page) =>
        request(`/instances?page=${page}&pageSize=${MAX_PAGE_SIZE}`, {
          signal,
          parse: parseInstancePage,
        }),
      ),
    refetchInterval: poll ? 60_000 : false,
  });
}

/** 读取单个实例，每 60 秒刷新以反映后台记录的认证状态变化。
 * @param id 实例 ID。
 * @returns 实例查询。
 * @throws 不适用。
 */
export function useInstance(id: string) {
  const { request } = useAuth();
  return useQuery({
    queryKey: instanceKeys.detail(id),
    queryFn: ({ signal }) =>
      request(`/instances/${encodeURIComponent(id)}`, {
        signal,
        parse: parseInstance,
      }),
    refetchInterval: 60_000,
  });
}

/** 写入实例详情缓存并刷新目录。
 * @param queryClient 查询客户端。
 * @param data 最新实例。
 * @returns 不适用。
 * @throws 不适用。
 */
function storeInstance(
  queryClient: ReturnType<typeof useQueryClient>,
  data: Instance,
): void {
  queryClient.setQueryData(instanceKeys.detail(data.id), data);
  void queryClient.invalidateQueries({ queryKey: instanceKeys.catalog });
}

/** 创建实例；成功返回新实例，调用方据此跳到详情页。
 * @returns 变更对象，变量为实例输入。
 * @throws 不适用。
 */
export function useCreateInstance() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: InstanceInput) =>
      request('/instances', {
        method: 'POST',
        body: body as object,
        parse: parseInstance,
      }),
    onSuccess: (data) => storeInstance(queryClient, data),
  });
}

/** 修改实例（只发送变化的字段）。
 * @param id 实例 ID。
 * @returns 变更对象，变量为实例补丁。
 * @throws 不适用。
 */
export function useUpdateInstance(id: string) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: InstanceInput) =>
      request(`/instances/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: body as object,
        parse: parseInstance,
      }),
    onSuccess: (data) => storeInstance(queryClient, data),
  });
}

/** 归档实例；仍被活动任务引用时后端返回 409。
 * @returns 变更对象，变量为实例 ID。
 * @throws 不适用。
 */
export function useArchiveInstance() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request(`/instances/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        parse: parseEmpty,
      }),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: instanceKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: instanceKeys.catalog });
    },
  });
}

/** 测试连接；被封锁时传 retryAuth=true 重新尝试认证。成功后刷新实例状态。
 * @returns 变更对象，变量为 { id, retryAuth }。
 * @throws 不适用。
 */
export function useInstanceTest() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, retryAuth }: { id: string; retryAuth: boolean }) =>
      request(`/instances/${encodeURIComponent(id)}/test`, {
        method: 'POST',
        body: { retryAuth },
        parse: parseTestResult,
      }),
    onSettled: (_data, _error, { id }) => {
      void queryClient.invalidateQueries({ queryKey: instanceKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: instanceKeys.catalog });
    },
  });
}

/** 浏览实例目录（不缓存结果，路径密码只随请求发送）。
 * @param id 实例 ID。
 * @returns 变更对象，变量为浏览参数。
 * @throws 不适用。
 */
export function useInstanceBrowse(id: string) {
  const { request } = useAuth();
  return useMutation({
    gcTime: 0,
    mutationFn: (params: {
      path: string;
      password?: string;
      refresh?: boolean;
      page?: number;
      pageSize?: number;
    }) =>
      request(`/instances/${encodeURIComponent(id)}/browse`, {
        method: 'POST',
        body: params,
        parse: parseBrowseResult,
      }),
  });
}
