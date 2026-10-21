// 将未认证或待改密会话限制在允许访问的路由内。
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './auth-context';

/** 检查会话并在渲染私有布局之前完成路由重定向。
 * @returns 路由出口或登录、改密跳转。
 * @throws 不适用；后端仍独立执行实际授权。
 */
export function ProtectedRoute() {
  const { session } = useAuth();
  const { pathname } = useLocation();
  if (!session) return <Navigate to="/login" replace />;
  if (session.mustChangePassword && pathname !== '/change-password')
    return <Navigate to="/change-password" replace />;
  return <Outlet />;
}
