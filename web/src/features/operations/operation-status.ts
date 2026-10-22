// 操作列表与详情共用的展示映射：状态色调、动作图标和路径拆分。
import { FilePlus2, FolderPlus, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { OperationView } from './operation-contract';

/** Badge 支持的语义变体。 */
export type BadgeVariant =
  'success' | 'danger' | 'warning' | 'default' | 'info' | 'active';

/** 把操作状态映射为 Badge 变体与是否呼吸。
 * @param status 操作状态。
 * @returns Badge 属性。
 * @throws 不适用。
 */
export function statusBadge(status: OperationView['status']): {
  variant: BadgeVariant;
  pulse: boolean;
} {
  switch (status) {
    case 'succeeded':
      return { variant: 'success', pulse: false };
    case 'failed':
      return { variant: 'danger', pulse: false };
    case 'unknown':
      return { variant: 'danger', pulse: true };
    case 'pending':
      return { variant: 'info', pulse: false };
    case 'submitting':
    case 'submitted':
    case 'running':
      return { variant: 'active', pulse: true };
    default:
      return { variant: 'default', pulse: false };
  }
}

/** 逻辑动作对应的 Lucide 图标。 */
export const ACTION_ICONS: Record<OperationView['action'], LucideIcon> = {
  mkdir: FolderPlus,
  create: FilePlus2,
  delete: Trash2,
};

/** 把绝对路径拆成父目录与末段名称；根目录返回空名称。
 * @param path 账号内绝对路径。
 * @returns 父目录（带结尾斜线）与名称。
 * @throws 不适用。
 */
export function splitPath(path: string): { parent: string; name: string } {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const cut = trimmed.lastIndexOf('/');
  if (cut < 0) return { parent: '', name: trimmed };
  return { parent: trimmed.slice(0, cut + 1), name: trimmed.slice(cut + 1) };
}
