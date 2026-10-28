// 文件操作的取数：跨运行列表首页发现新结果，含未完成操作的页面及详情持续轮询。
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import {
  operationNeedsPolling,
  parseOperation,
  parseOperationPage,
} from './operation-contract';

/** 跨运行操作列表的筛选与分页。 */
export interface OperationListParams {
  /** 页码。 */
  page: number;
  /** 页大小。 */
  pageSize: number;
  /** 操作状态。 */
  status?: string;
  /** 源或目标实例。 */
  instanceId?: string;
}

/** 操作相关查询键。 */
export const operationKeys = {
  all: ['operations'] as const,
  list: (params: OperationListParams) =>
    ['operations', 'list', params] as const,
  detail: (id: string) => ['operations', 'detail', id] as const,
};

/** 读取一页跨运行操作；含未完成操作时5秒刷新，第一页空闲时15秒发现新结果。
 * @param params 筛选与分页。
 * @returns 操作分页查询。
 * @throws 不适用。
 */
export function useOperations(params: OperationListParams) {
  const { request } = useAuth();
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.status) search.set('status', params.status);
  if (params.instanceId) search.set('instanceId', params.instanceId);
  return useQuery({
    queryKey: operationKeys.list(params),
    queryFn: ({ signal }) =>
      request(`/operations?${search.toString()}`, {
        signal,
        parse: parseOperationPage,
      }),
    refetchInterval: (query) =>
      query.state.data?.items.some(operationNeedsPolling)
        ? 5_000
        : params.page === 1
          ? 15_000
          : false,
  });
}

/** 读取单条操作；未完成时每 5 秒刷新。enabled=false 时不请求（例如侧边面板未打开）。
 * @param id 操作 ID。
 * @param enabled 是否请求。
 * @returns 操作查询。
 * @throws 不适用。
 */
export function useOperation(id: string, enabled = true) {
  const { request } = useAuth();
  return useQuery({
    queryKey: operationKeys.detail(id),
    queryFn: ({ signal }) =>
      request(`/operations/${encodeURIComponent(id)}`, {
        signal,
        parse: parseOperation,
      }),
    enabled: enabled && id !== '',
    refetchInterval: (query) =>
      query.state.data && operationNeedsPolling(query.state.data)
        ? 5_000
        : false,
  });
}
