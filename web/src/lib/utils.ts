// 合并条件类名与 Tailwind 冲突类，供共享组件使用。
import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** 合并条件类名并保留最后一个同类 Tailwind 样式。
 * @param inputs 字符串、数组或条件对象。
 * @returns 可直接赋给 className 的字符串。
 * @throws 不适用。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
