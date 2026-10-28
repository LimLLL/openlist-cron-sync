// 装配路由、查询、认证、提示条与悬停提示；加载只通过顶部进度条与原位骨架表达，不替换页面框架。
import { Suspense, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AuthProvider } from '../features/auth/auth-context';
import { LoginPage } from '../features/auth/login-page';
import { ProtectedRoute } from '../features/auth/protected-route';
import { useDocumentTitle } from '../components/page';
import { EmptyState } from '../components/states';
import { SuspenseProgress, TopProgress } from '../components/top-progress';
import { Button } from '../components/ui/button';
import { Toaster } from '../components/ui/toast';
import { TooltipProvider } from '../components/ui/tooltip';
import { AppLayout } from './app-layout';
import { useThemePreference } from './theme';
import {
  InstanceCreatePage,
  InstanceDetailPage,
  InstanceEditPage,
  InstancesPage,
  JobCreatePage,
  JobDetailPage,
  JobEditPage,
  JobsPage,
  OperationDetailPage,
  OperationsPage,
  OverviewPage,
  PasswordPage,
  RunDetailPage,
  RunsPage,
} from './pages';

/** 显示不存在的客户端页面，提供返回概览的入口。
 * @returns 未找到页面。
 * @throws 不适用。
 */
function NotFoundPage() {
  const { t } = useTranslation('common');
  useDocumentTitle(t('notFound.title'));
  return (
    <EmptyState
      title={t('notFound.title')}
      description={t('notFound.description')}
      action={
        <Button asChild>
          <Link to="/">{t('notFound.back')}</Link>
        </Button>
      }
    />
  );
}

/** 创建应用级 provider；QueryClient 随应用实例创建且不持久化。
 * @returns 完整 SPA。
 * @throws 不适用。
 */
export function App() {
  // 登录页同样跟随系统及跨标签页偏好，不依赖账户菜单是否挂载。
  useThemePreference();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: false },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TopProgress />
      <AuthProvider>
        <TooltipProvider delayDuration={300} skipDelayDuration={200}>
          <BrowserRouter>
            <Suspense fallback={<SuspenseProgress />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route element={<AppLayout />}>
                    <Route index element={<OverviewPage />} />
                    <Route path="jobs" element={<JobsPage />} />
                    <Route path="jobs/new" element={<JobCreatePage />} />
                    <Route path="jobs/:id" element={<JobDetailPage />} />
                    <Route path="jobs/:id/edit" element={<JobEditPage />} />
                    <Route path="runs" element={<RunsPage />} />
                    <Route path="runs/:id" element={<RunDetailPage />} />
                    <Route path="instances" element={<InstancesPage />} />
                    <Route
                      path="instances/new"
                      element={<InstanceCreatePage />}
                    />
                    <Route
                      path="instances/:id"
                      element={<InstanceDetailPage />}
                    />
                    <Route
                      path="instances/:id/edit"
                      element={<InstanceEditPage />}
                    />
                    <Route path="operations" element={<OperationsPage />} />
                    <Route
                      path="operations/:id"
                      element={<OperationDetailPage />}
                    />
                    <Route path="change-password" element={<PasswordPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Route>
              </Routes>
            </Suspense>
            <Toaster />
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
