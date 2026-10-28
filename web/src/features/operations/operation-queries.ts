// 操作历史查询与活动执行进度 hooks。
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import {
  operationNeedsPolling,
  parseOperation,
  parseOperationPage,
} from './operation-contract';

/** 查询全局操作分页列表。
 * @param params 分页和过滤参数。
 * @returns TanStack Query 结果。
 * @throws 不适用。
 */
export function useOperations(params: {
  page: number;
  pageSize: number;
  status?: string;
  instanceId?: string;
}) {
  const { request } = useAuth();
  const search = new URLSearchParams();
  search.set('page', String(params.page));
  search.set('pageSize', String(params.pageSize));
  if (params.status) search.set('status', params.status);
  if (params.instanceId) search.set('instanceId', params.instanceId);
  const query = search.toString();
  return useQuery({
    queryKey: ['operations', query],
    queryFn: ({ signal }) =>
      request(`/operations?${query}`, { signal, parse: parseOperationPage }),
    refetchInterval: (query) =>
      query.state.data?.items.some(operationNeedsPolling) ? 2500 : false,
  });
}

/** 查询单个操作详情。
 * @param id 操作 UUID。
 * @returns TanStack Query 结果。
 * @throws 不适用。
 */
export function useOperationDetail(id: string) {
  const { request } = useAuth();
  return useQuery({
    queryKey: ['operations', id],
    queryFn: ({ signal }) =>
      request(`/operations/${id}`, { signal, parse: parseOperation }),
    refetchInterval: (query) =>
      query.state.data && operationNeedsPolling(query.state.data)
        ? 2500
        : false,
  });
}
