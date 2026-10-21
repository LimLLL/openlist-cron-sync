// 在页面渲染或分片加载失败时保留应用框架，并提供显式重新加载入口。
import { Component } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from './states';

/** 页面错误边界；路由变化通过父组件的 key 创建新的边界。
 * Suspense 只处理待定 Promise，无法处理已经拒绝的 import。
 */
export class PageErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  /** 将渲染错误转换成可恢复的页面状态。
   * @returns 失败状态。
   * @throws 不适用。
   */
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  /** 保留正常页面，失败时显示本地化提示。
   * @returns 当前页面或错误提示。
   * @throws 不适用。
   */
  render() {
    return this.state.failed ? <PageFailure /> : this.props.children;
  }
}

/** 随语言切换更新错误提示；整页重载才能清除 React.lazy 缓存的拒绝结果。
 * @returns 错误提示及重新加载操作。
 * @throws 不适用。
 */
function PageFailure() {
  const { t } = useTranslation('common');
  return (
    <ErrorState
      error={new Error(t('states.pageError'))}
      onRetry={() => window.location.reload()}
    />
  );
}
