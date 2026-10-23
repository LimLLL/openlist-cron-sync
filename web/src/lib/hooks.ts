// 共享导航与分页 hooks，保持 URL 为分页状态的唯一真相源。
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/** 分页参数。 */
export interface PageParams {
  /** 当前页号，从 1 开始。 */
  page: number;
  /** 每页条数。 */
  pageSize: number;
}

/** 从 URL search params 读取分页参数，提供类型安全的更新方法。
 * @param defaults 默认分页配置。
 * @param namespace 独立标签页的 URL 参数前缀。
 * @returns 当前分页和翻页方法。
 * @throws 不适用。
 */
export function usePageParams(
  defaults: PageParams = { page: 1, pageSize: 50 },
  namespace = '',
) {
  const [searchParams, setSearchParams] = useSearchParams();
  const pageKey = namespace ? `${namespace}Page` : 'page';
  const sizeKey = namespace ? `${namespace}PageSize` : 'pageSize';
  const { page, pageSize } = parsePageParams(searchParams, defaults, namespace);

  /** 更新分页参数，保留其他 search params。
   * @param next 要更新的分页字段。
   * @returns 不适用。
   * @throws 不适用。
   */
  const setPage = useCallback(
    (next: Partial<PageParams>) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next.page !== undefined) {
            if (next.page <= 1) params.delete(pageKey);
            else params.set(pageKey, String(next.page));
          }
          if (next.pageSize !== undefined) {
            if (next.pageSize === defaults.pageSize) params.delete(sizeKey);
            else params.set(sizeKey, String(next.pageSize));
            if (next.page === undefined) params.delete(pageKey);
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams, defaults.pageSize, pageKey, sizeKey],
  );

  return { page, pageSize, setPage } as const;
}

/** 严格读取分页整数，拒绝截断、非有限值和会导致后端 offset 溢出的页号。
 * @param searchParams 当前 URL 参数。
 * @param defaults 缺失或非法输入时的页号及页大小。
 * @param namespace 独立标签页的参数前缀，空字符串使用公共分页键。
 * @returns 后端可接受的分页参数。
 * @throws 不适用。
 */
export function parsePageParams(
  searchParams: URLSearchParams,
  defaults: PageParams,
  namespace = '',
): PageParams {
  const rawSize = searchParams.get(
    namespace ? `${namespace}PageSize` : 'pageSize',
  );
  const size =
    rawSize && /^\d+$/.test(rawSize) ? Number(rawSize) : defaults.pageSize;
  const pageSize =
    Number.isSafeInteger(size) && size >= 1 && size <= 200
      ? size
      : defaults.pageSize;
  const rawPage = searchParams.get(namespace ? `${namespace}Page` : 'page');
  const page =
    rawPage && /^\d+$/.test(rawPage) ? Number(rawPage) : defaults.page;
  return {
    page:
      Number.isSafeInteger(page) &&
      page >= 1 &&
      Number.isSafeInteger((page - 1) * pageSize)
        ? page
        : defaults.page,
    pageSize,
  };
}

/** 从 URL 读取可选的字符串筛选参数；修改筛选时回到第一页。
 * @param key 参数名。
 * @param pageKey 筛选所属列表的页码参数；同页多个列表各自翻页时传入带前缀的键。
 * @returns [当前值, 设置方法]。
 * @throws 不适用。
 */
export function useFilterParam(
  key: string,
  pageKey = 'page',
): [string | undefined, (value: string | undefined) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = searchParams.get(key) ?? undefined;

  const setValue = useCallback(
    (next: string | undefined) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next) params.set(key, next);
          else params.delete(key);
          params.delete(pageKey);
          return params;
        },
        { replace: true },
      );
    },
    [key, pageKey, setSearchParams],
  );

  return [value, setValue];
}
