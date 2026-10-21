// 管理仅存在内存中的管理员会话；退出时中止请求并清空 Query 缓存。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, ApiError } from '../../lib/api-client';
import type { JsonRequestOptions } from '../../lib/api-client';
import { parseAdministrator, parseLogin } from './auth-contract';

/** 内存会话，不进入 URL、浏览器存储或 Query 缓存。 */
export interface Session {
  /** 管理 JWT。 */
  accessToken: string;
  /** 后端确认的用户名。 */
  username: string;
  /** 过期时间，Unix 毫秒。 */
  expiresAt: number;
  /** 是否只允许修改密码。 */
  mustChangePassword: boolean;
}

/** 登录页可展示的退出原因。 */
type SessionNotice = 'signed-out' | 'expired' | 'password-changed' | null;

/** 认证消费者使用的操作，不提供持久化入口。 */
interface AuthContextValue {
  /** 当前会话，没有登录时为 null。 */
  session: Session | null;
  /** 退出原因，登录成功后清空。 */
  notice: SessionNotice;
  /** 验证密码并读取当前管理员；信号取消后不建立会话。 */
  login: (
    username: string,
    password: string,
    signal: AbortSignal,
  ) => Promise<void>;
  /** 立即清空会话和查询、变更缓存。 */
  logout: (notice?: SessionNotice) => void;
  /** 改密成功后撤销本地会话，与服务端撤销规则保持一致。 */
  changePassword: (
    currentPassword: string,
    newPassword: string,
    signal: AbortSignal,
  ) => Promise<void>;
  /** 已认证 JSON 请求；过期或撤销时退出，其他错误返回调用方。 */
  request: <T>(
    path: `/${string}`,
    options: Omit<JsonRequestOptions<T>, 'token'>,
  ) => Promise<T>;
}

/** 当前会话及其网络请求的生命周期，避免旧响应更新新会话。 */
interface ActiveSession {
  /** 公开给组件的会话。 */
  data: Session;
  /** 退出或更换会话时取消所有旧请求。 */
  controller: AbortController;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** 提供内存认证上下文及过期清理。
 * @param props 子组件。
 * @returns 认证上下文 provider。
 * @throws 不适用；网络错误由公开操作返回调用方。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [notice, setNotice] = useState<SessionNotice>(null);
  const active = useRef<ActiveSession | null>(null);

  /** 取消旧会话后同步清缓存，禁止迟到请求恢复旧用户数据。
   * @param reason 登录页提示原因。
   * @returns 不适用。
   * @throws 不适用。
   */
  const logout = useCallback(
    (reason: SessionNotice = 'signed-out') => {
      active.current?.controller.abort();
      active.current = null;
      queryClient.clear();
      setSession(null);
      setNotice(reason);
    },
    [queryClient],
  );

  /** 仅处理当前会话的认证错误，不把错误密码误判为会话失效。
   * @param error API 返回的错误。
   * @param current 发起请求时的会话。
   * @returns 不适用，原始错误由调用者继续抛出。
   * @throws 不适用。
   */
  const handleSessionError = useCallback(
    (error: unknown, current: ActiveSession) => {
      if (active.current !== current || !(error instanceof ApiError)) return;
      if (error.code === 'UNAUTHENTICATED' || error.code === 'TOKEN_REVOKED')
        logout('expired');
      if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
        current.data = { ...current.data, mustChangePassword: true };
        setSession(current.data);
      }
    },
    [logout],
  );

  /** 登录后确认管理员身份，不缓存密码或登录响应。
   * @param username 原始用户名。
   * @param password 原始密码。
   * @param signal 表单生命周期信号。
   * @returns 会话建立完成。
   * @throws ApiError 登录失败；AbortError 表单已退出。
   */
  const login = useCallback(
    async (username: string, password: string, signal: AbortSignal) => {
      const startedAt = Date.now();
      const result = await apiRequest('/auth/login', {
        method: 'POST',
        body: { username, password },
        signal,
        parse: parseLogin,
      });
      const administrator = await apiRequest('/auth/me', {
        token: result.accessToken,
        signal,
        parse: parseAdministrator,
      });
      signal.throwIfAborted();
      active.current?.controller.abort();
      queryClient.clear();
      const data: Session = {
        accessToken: result.accessToken,
        username: administrator.username,
        expiresAt: startedAt + result.expiresIn * 1000,
        mustChangePassword:
          result.mustChangePassword || administrator.mustChangePassword,
      };
      active.current = { data, controller: new AbortController() };
      setNotice(null);
      setSession(data);
    },
    [queryClient],
  );

  /** 发送绑定到当前会话的 JSON 请求。
   * @template T 已校验的响应类型。
   * @param path API 路径。
   * @param options 请求参数和响应校验器。
   * @returns 校验后的数据。
   * @throws ApiError 请求失败或没有会话；AbortError 会话或调用方取消。
   */
  const request = useCallback(
    async <T,>(
      path: `/${string}`,
      options: Omit<JsonRequestOptions<T>, 'token'>,
    ): Promise<T> => {
      const current = active.current;
      if (!current)
        throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      const signal = options.signal
        ? AbortSignal.any([options.signal, current.controller.signal])
        : current.controller.signal;
      try {
        return await apiRequest(path, {
          ...options,
          token: current.data.accessToken,
          signal,
        });
      } catch (error) {
        handleSessionError(error, current);
        throw error;
      }
    },
    [handleSessionError],
  );

  /** 修改密码，204 成功后立即清除当前和缓存中的认证数据。
   * @param currentPassword 当前原始密码。
   * @param newPassword 新原始密码。
   * @param signal 表单生命周期信号。
   * @returns 密码修改完成。
   * @throws ApiError 密码错误、限流或会话失效；AbortError 请求取消。
   */
  const changePassword = useCallback(
    async (
      currentPassword: string,
      newPassword: string,
      signal: AbortSignal,
    ) => {
      const current = active.current;
      if (!current)
        throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      try {
        await apiRequest('/auth/change-password', {
          method: 'POST',
          token: current.data.accessToken,
          body: { currentPassword, newPassword },
          signal: AbortSignal.any([signal, current.controller.signal]),
        });
        if (active.current === current) logout('password-changed');
      } catch (error) {
        handleSessionError(error, current);
        throw error;
      }
    },
    [handleSessionError, logout],
  );

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(
      () => logout('expired'),
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [session, logout]);

  useEffect(
    () => () => {
      active.current?.controller.abort();
    },
    [],
  );

  return (
    <AuthContext.Provider
      value={{ session, notice, login, logout, changePassword, request }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** 读取认证操作并验证 provider 已安装。
 * @returns 当前会话和认证操作。
 * @throws Error 组件没有置于 AuthProvider 内。
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth requires AuthProvider');
  return context;
}
