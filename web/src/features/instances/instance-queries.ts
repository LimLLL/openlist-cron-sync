// TanStack Query hooks 用于实例 CRUD、连接测试与目录浏览。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { parseEmpty } from '../../lib/parsers';
import { useAuth } from '../auth/auth-context';
import {
  parseInstance,
  parseInstancePage,
  parseTestResult,
  parseBrowseResult,
} from './instance-contract';
import type { InstanceInput } from './instance-contract';

/** 实例列表查询。
 * @param page 页号。
 * @param pageSize 每页条数。
 * @returns TanStack Query 结果。
 * @throws 不适用；错误通过 query.error 返回。
 */
export function useInstances(page: number, pageSize: number) {
  const { request } = useAuth();
  return useQuery({
    queryKey: ['instances', { page, pageSize }],
    queryFn: ({ signal }) =>
      request(`/instances?page=${page}&pageSize=${pageSize}`, {
        signal,
        parse: parseInstancePage,
      }),
  });
}

/** 单个实例查询。
 * @param id 实例 UUID。
 * @returns TanStack Query 结果。
 * @throws 不适用。
 */
export function useInstance(id: string) {
  const { request } = useAuth();
  return useQuery({
    queryKey: ['instances', id],
    queryFn: ({ signal }) =>
      request(`/instances/${id}` as `/${string}`, {
        signal,
        parse: parseInstance,
      }),
  });
}

/** 创建实例 mutation。
 * @returns mutation 对象。
 * @throws 不适用。
 */
export function useCreateInstance() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: InstanceInput) =>
      request('/instances', {
        method: 'POST',
        body: body as object,
        parse: parseInstance,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['instances'] });
      navigate('/instances');
    },
  });
}

/** 更新实例 mutation。
 * @param id 实例 UUID。
 * @returns mutation 对象。
 * @throws 不适用。
 */
export function useUpdateInstance(id: string) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: InstanceInput) =>
      request(`/instances/${id}` as `/${string}`, {
        method: 'PATCH',
        body: body as object,
        parse: parseInstance,
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.setQueryData(['instances', id], data);
      void queryClient.invalidateQueries({ queryKey: ['instances'] });
    },
  });
}

/** 归档实例 mutation，204 也受会话撤销和请求取消保护。
 * @returns mutation 对象。
 * @throws 不适用。
 */
export function useArchiveInstance() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (id: string) => {
      await request(`/instances/${id}` as `/${string}`, {
        method: 'DELETE',
        parse: parseEmpty,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['instances'] });
      navigate('/instances');
    },
  });
}

/** 连接测试 mutation。
 * @param id 实例 UUID。
 * @returns mutation 对象。
 * @throws 不适用。
 */
export function useInstanceTest(id: string) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (retryAuth: boolean) =>
      request(`/instances/${id}/test` as `/${string}`, {
        method: 'POST',
        body: { retryAuth },
        parse: parseTestResult,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['instances'] });
    },
  });
}

/** 目录浏览 mutation（按需触发，不缓存）。
 * @param id 实例 UUID。
 * @returns mutation 对象。
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
      request(`/instances/${id}/browse` as `/${string}`, {
        method: 'POST',
        body: params,
        parse: parseBrowseResult,
      }),
  });
}
