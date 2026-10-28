// 外壳持有的就绪检查轮询：公开端点、无需令牌，503 也作为正常数据读取。
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';
import { parseHealth } from './health-contract';
import type { HealthView } from './health-contract';

/** 外壳唯一持有就绪轮询；桌面和移动侧栏只订阅缓存。
 * @param poll 是否持有请求与30秒轮询。
 * @returns 就绪检查查询。
 * @throws 不适用；错误通过查询状态返回。
 */
export function useHealth(poll = false) {
  return useQuery<HealthView>({
    queryKey: ['system', 'health'],
    queryFn: ({ signal }) =>
      apiRequest('/system/health/ready', {
        parse: parseHealth,
        acceptedStatuses: [503],
        signal,
      }),
    enabled: poll,
    refetchInterval: poll ? 30_000 : false,
    staleTime: 15_000,
  });
}
