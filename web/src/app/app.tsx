// 装配路由、查询与认证；加载只通过顶部进度条表达，不替换页面框架。
import { Suspense, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { MotionConfig } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AuthProvider } from '../features/auth/auth-context';
import { LoginPage } from '../features/auth/login-page';
import { ProtectedRoute } from '../features/auth/protected-route';
import { EmptyState } from '../components/states';
import { AmbientCanvas } from '../components/ambient-canvas';
import { SuspenseProgress, TopProgress } from '../components/top-progress';
import { Button } from '../components/ui/button';
import { AppLayout } from './app-layout';
import {
  DashboardPage,
  InstanceCreatePage,
  InstanceDetailPage,
  InstancesPage,
  JobCreatePage,
  JobDetailPage,
  JobEditPage,
  JobsPage,
  OperationDetailPage,
  OperationsPage,
  PasswordPage,
  RunDetailPage,
  RunsPage,
} from './pages';

/** 显示不存在的客户端页面，保留返回工作区的明确入口。
 * @returns 未找到页面。
 * @throws 不适用。
 */
function NotFoundPage() {
  const { t } = useTranslation('common');
  return (
    <EmptyState
      title={t('notFound.title')}
      description={t('notFound.description')}
      action={
        <Button asChild variant="secondary">
          <Link to="/">
            <ArrowLeft size={16} aria-hidden="true" />
            {t('notFound.back')}
          </Link>
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
      {/* 背景三层：星尘画布、顶部极光、胶片颗粒；都在内容之下且不接收指针事件。 */}
      <AmbientCanvas />
      <div className="aurora" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <AuthProvider>
        <MotionConfig reducedMotion="user">
          <BrowserRouter>
            <Suspense fallback={<SuspenseProgress />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route element={<AppLayout />}>
                    <Route index element={<DashboardPage />} />
                    <Route path="instances" element={<InstancesPage />} />
                    <Route path="instances/new" element={<InstanceCreatePage />} />
                    <Route path="instances/:id" element={<InstanceDetailPage />} />
                    <Route path="jobs" element={<JobsPage />} />
                    <Route path="jobs/new" element={<JobCreatePage />} />
                    <Route path="jobs/:id" element={<JobDetailPage />} />
                    <Route path="jobs/:id/edit" element={<JobEditPage />} />
                    <Route path="runs" element={<RunsPage />} />
                    <Route path="runs/:id" element={<RunDetailPage />} />
                    <Route path="operations" element={<OperationsPage />} />
                    <Route path="operations/:id" element={<OperationDetailPage />} />
                    <Route path="change-password" element={<PasswordPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </MotionConfig>
      </AuthProvider>
    </QueryClientProvider>
  );
}
