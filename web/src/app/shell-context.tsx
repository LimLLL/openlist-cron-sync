// 页面与应用外壳之间的通道：页面把主操作放进固定顶栏，大标题滚出视口后让顶栏显示紧凑标题。
import { createContext, useContext } from 'react';

/** 外壳向页面开放的能力。 */
export interface ShellContextValue {
  /** 顶栏右侧的操作挂载点；尚未挂载时为 null。 */
  actionsSlot: HTMLElement | null;
  /** 设置顶栏紧凑标题；null 表示恢复显示面包屑。 */
  setCompactTitle: (title: string | null) => void;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

/** 读取外壳通道；在外壳之外（如登录页或测试）返回 null，调用方应退化为页内渲染。
 * @returns 外壳能力或 null。
 * @throws 不适用。
 */
export function useShell(): ShellContextValue | null {
  return useContext(ShellContext);
}
