// 主题偏好（跟随系统/浅色/深色）：持久化到 localStorage，并把实际生效的主题写到 <html class="dark">。
import { useSyncExternalStore } from 'react';

/** 用户选择的主题偏好；system 表示跟随操作系统。 */
export type ThemePreference = 'system' | 'light' | 'dark';

/** 与 index.html 首帧脚本共用的存储键。 */
const STORAGE_KEY = 'ocs_theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();

/** 读取已保存的偏好；未保存、非法值或存储不可用时视为跟随系统。
 * @returns 主题偏好。
 * @throws 不适用。
 */
function readStored(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

// 内存副本是唯一读取来源；存储被禁用时偏好仍在本页面内生效。
let current: ThemePreference =
  typeof window === 'undefined' ? 'system' : readStored();

/** 把当前偏好对应的实际主题写到根元素并通知订阅者。
 * @returns 不适用。
 * @throws 不适用。
 */
function apply(): void {
  const dark =
    current === 'dark' ||
    (current === 'system' && window.matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle('dark', dark);
  listeners.forEach((listener) => listener());
}

/** 订阅系统主题和其他标签页的偏好变化。
 * @param listener 变化回调。
 * @returns 取消订阅函数。
 * @throws 不适用。
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  apply();
  const media = window.matchMedia(DARK_QUERY);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    current = readStored();
    apply();
  };
  // 系统切换深浅色时只有“跟随系统”会改变结果，apply 自行判断。
  media.addEventListener('change', apply);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    media.removeEventListener('change', apply);
    window.removeEventListener('storage', onStorage);
  };
}

/** 保存偏好并立即应用。
 * @param preference 新偏好。
 * @returns 不适用。
 * @throws 不适用；存储不可用时只影响当前页面。
 */
export function setThemePreference(preference: ThemePreference): void {
  current = preference;
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // 存储被禁用时仍切换本次页面的主题。
  }
  apply();
}

/** 读取当前主题偏好，并在偏好变化时重新渲染。
 * @returns 当前偏好。
 * @throws 不适用。
 */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 'system',
  );
}
