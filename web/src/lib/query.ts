// 全量加载分页目录：依次请求每一页并按 ID 去重，供任务/实例在前端搜索、筛选与排序。
import type { Page } from './parsers';

/** 后端分页上限，用最少的请求取完整目录。 */
export const MAX_PAGE_SIZE = 200;

/** 依次读取所有页面并合并；不设隐藏截断上限。
 * @template T 带 id 的列表项。
 * @param load 读取指定页码的函数。
 * @returns 去重后的完整列表（保持服务端顺序）。
 * @throws ApiError 任意一页失败；AbortError 请求已取消。部分结果不会被当作完整目录返回。
 */
export async function fetchAllPages<T extends { id: string }>(
  load: (page: number) => Promise<Page<T>>,
): Promise<T[]> {
  const seen = new Map<string, T>();
  let page = 1;
  let pages = 1;
  do {
    const result = await load(page);
    // 多次请求之间可能有新增或归档导致偏移，按 ID 去重而不是假定快照一致。
    for (const item of result.items)
      if (!seen.has(item.id)) seen.set(item.id, item);
    pages = Math.max(1, Math.ceil(result.total / result.pageSize));
    page += 1;
  } while (page <= pages);
  return [...seen.values()];
}
