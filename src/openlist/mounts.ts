// 从完整管理员存储映射计算有效挂载，不推测歧义或回退父存储。
import { boolean, integer, object, protocol, string } from './errors.js';
import { containsPath, normalizeGlobalPath } from './paths.js';

/** 筛选后的存储事实，明确丢弃 addition 等敏感字段。 */
export interface Storage {
  /** 上游存储 ID。 */
  id: number;
  /** 原始挂载路径。 */
  mountPath: string;
  /** 按最后一次 .balance 截断后的路径。 */
  effectiveMount: string;
  /** 驱动名称。 */
  driver: string;
  /** 是否禁用；禁用边界仍保留。 */
  disabled: boolean;
  /** 上游初始化状态。 */
  status: string;
}
/** 某个全局路径的挂载事实。 */
export interface MountResolution {
  /** 最长匹配的全部候选，不剔除禁用/失败项后回退。 */
  candidates: Storage[];
  /** 唯一且可用的存储；歧义或不可用时为 null。 */
  storage: Storage | null;
  /** 是否为嵌套挂载的严格祖先。 */
  suspect: boolean;
}
/** 解析存储分页的最小字段集。
 * @param input 上游 data。
 * @returns 当前页及总数。
 * @throws OpenListError 必要字段或挂载非法。
 */
export function storagePage(input: unknown): {
  content: Storage[];
  total: number;
} {
  const data = object(input);
  if (!Array.isArray(data.content)) protocol('storage content');
  return {
    content: data.content.map(parseStorage),
    total: integer(data.total),
  };
}
/** 丢弃单条 storage 的全部非必要字段。
 * @param input 原始存储。
 * @returns 安全存储事实。
 * @throws OpenListError 协议不匹配。
 */
function parseStorage(input: unknown): Storage {
  const row = object(input);
  const mountPath = string(row.mount_path);
  return {
    id: integer(row.id),
    mountPath,
    effectiveMount: effectiveMount(mountPath),
    driver: string(row.driver),
    disabled: boolean(row.disabled),
    status: string(row.status),
  };
}
/** 复现 strings.LastIndex 截断语义。
 * @param mountPath 原始挂载路径。
 * @returns 规范化有效挂载。
 * @throws OpenListError 非法路径。
 */
export function effectiveMount(mountPath: string): string {
  const index = mountPath.lastIndexOf('.balance');
  const path = index < 0 ? mountPath : mountPath.slice(0, index);
  try {
    return normalizeGlobalPath(path);
  } catch {
    return protocol('mount path');
  }
}
/** 按路径段执行最长匹配，歧义候选绝不猜测。
 * @param storages 完整存储映射。
 * @param path 规范化全局路径。
 * @returns 候选、唯一可用项和嵌套风险。
 * @throws 不适用。
 */
export function resolveMount(
  storages: Storage[],
  path: string,
): MountResolution {
  let candidates: Storage[] = [];
  let longest = -1;
  let suspect = false;
  for (const storage of storages) {
    const mount = storage.effectiveMount;
    if (path !== mount && containsPath(path, mount)) suspect = true;
    if (!containsPath(mount, path)) continue;
    if (mount.length > longest) {
      candidates = [];
      longest = mount.length;
    }
    if (mount.length === longest) candidates.push(storage);
  }
  const only = candidates.length === 1 ? candidates[0] : undefined;
  return {
    candidates,
    storage: only && !only.disabled && only.status === 'work' ? only : null,
    suspect,
  };
}
