// 操作数据查询与管理动作 hooks。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  unresolved?: string;
}) {
  const { request } = useAuth();
  const search = new URLSearchParams();
  search.set('page', String(params.page));
  search.set('pageSize', String(params.pageSize));
  if (params.status) search.set('status', params.status);
  if (params.instanceId) search.set('instanceId', params.instanceId);
  if (params.unresolved) search.set('unresolved', params.unresolved);
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

/** 释放隔离变更。
 * @returns Mutation hook。
 * @throws 不适用。
 */
export function useQuarantineRelease() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      request(`/operations/${id}/quarantine-release`, {
        method: 'POST',
        body: { reason },
        parse: parseOperation,
      }),
    onSuccess: (data, { id }) => {
      queryClient.setQueryData(['operations', id], data);
      void queryClient.invalidateQueries({ queryKey: ['runs', data.runId] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['operations', id] });
      void queryClient.invalidateQueries({
        queryKey: ['operations'],
        exact: false,
      });
    },
  });
}

/** 放弃操作（resolve as abandoned）。
 * @returns Mutation hook。
 * @throws 不适用。
 */
export function useResolveOperation() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      request(`/operations/${id}/resolve`, {
        method: 'POST',
        body: { kind: 'abandoned', reason },
        parse: parseOperation,
      }),
    onSuccess: (data, { id }) => {
      queryClient.setQueryData(['operations', id], data);
      void queryClient.invalidateQueries({ queryKey: ['runs', data.runId] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['operations', id] });
      void queryClient.invalidateQueries({
        queryKey: ['operations'],
        exact: false,
      });
    },
  });
}
