// 装配路由、查询与内存认证，公开页面不挂载私有应用布局。
import { lazy, Suspense, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { MotionConfig } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { AuthProvider } from '../features/auth/auth-context';
import { LoginPage } from '../features/auth/login-page';
import { ProtectedRoute } from '../features/auth/protected-route';
import { EmptyState, LoadingState } from '../components/states';
import { Button } from '../components/ui/button';

// 登录入口无需下载私有布局、抽屉和账户页面；首次进入后按路由加载。
const AppLayout = lazy(() =>
  import('./app-layout').then((module) => ({ default: module.AppLayout })),
);
const WorkspacePage = lazy(() =>
  import('./workspace-page').then((module) => ({
    default: module.WorkspacePage,
  })),
);
const PasswordPage = lazy(() =>
  import('../features/auth/password-page').then((module) => ({
    default: module.PasswordPage,
  })),
);

/** 显示不存在的客户端页面，保留返回工作区的明确入口。
 * @returns 未找到页面。
 * @throws 不适用。
 */
function NotFoundPage() {
  return (
    <EmptyState
      title="Outside this orbit."
      description="The page you’re looking for doesn’t exist."
      action={
        <Button asChild variant="secondary">
          <Link to="/">
            <ArrowLeft size={16} aria-hidden="true" />
            Back to workspace
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
      <AuthProvider>
        <MotionConfig reducedMotion="user">
          <BrowserRouter>
            <Suspense fallback={<LoadingState />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route element={<AppLayout />}>
                    <Route index element={<WorkspacePage />} />
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
