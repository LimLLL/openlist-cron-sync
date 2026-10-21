// 管理管理员会话（localStorage 持久化）；退出时中止请求并清空 Query 缓存。
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
import { apiRequest, ApiError, isRecord } from '../../lib/api-client';
import type { JsonRequestOptions } from '../../lib/api-client';
import { parseAdministrator, parseLogin } from './auth-contract';

const STORAGE_KEY = 'ocs_session';

/** 会话数据，持久化到 localStorage。 */
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

/** 从 localStorage 恢复未过期会话；格式不符或已过期的记录会被清除。
 * @returns 有效会话或 null。
 * @throws 不适用；存储不可用或解析失败时返回 null，令牌失效由首个请求的 401 处理。
 */
function restoreSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const data: unknown = JSON.parse(raw);
    if (
      isRecord(data) &&
      typeof data.accessToken === 'string' &&
      /^[\x21-\x7e]+$/u.test(data.accessToken) &&
      typeof data.username === 'string' &&
      [...data.username].length >= 1 &&
      [...data.username].length <= 64 &&
      typeof data.expiresAt === 'number' &&
      Number.isSafeInteger(data.expiresAt) &&
      typeof data.mustChangePassword === 'boolean' &&
      data.expiresAt > Date.now() &&
      // 后端 TTL 最长一天，同时拒绝会令浏览器定时器溢出的损坏记录。
      data.expiresAt <= Date.now() + 86_400_000
    )
      return {
        accessToken: data.accessToken,
        username: data.username,
        expiresAt: data.expiresAt,
        mustChangePassword: data.mustChangePassword,
      };
  } catch {
    // 存储被禁用或内容损坏，按未登录处理。
  }
  clearPersistedSession();
  return null;
}

/** 持久化会话到 localStorage。
 * @param session 当前会话。
 * @param expectedToken 更新已有会话时必须匹配的令牌，避免旧标签页覆盖新登录。
 * @returns 不适用。
 * @throws 不适用。
 */
function persistSession(session: Session, expectedToken?: string): void {
  let previous: string | null | undefined;
  try {
    previous = localStorage.getItem(STORAGE_KEY);
    if (expectedToken !== undefined) {
      const stored: unknown = JSON.parse(previous ?? 'null');
      if (!isRecord(stored) || stored.accessToken !== expectedToken) return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // 写入失败时降级为内存；仅移除本次读取的旧值，不影响并发登录。
    try {
      if (
        previous !== undefined &&
        localStorage.getItem(STORAGE_KEY) === previous
      )
        localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 存储禁用时仍可使用当前内存会话。 */
    }
  }
}

/** 清除 localStorage 中的会话。
 * @param expectedToken 指定时只删除这个令牌，迟到的 401 不得删除其他标签页的新会话。
 * @returns 不适用。
 * @throws 不适用。
 */
function clearPersistedSession(expectedToken?: string): void {
  try {
    if (expectedToken !== undefined) {
      const stored: unknown = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? 'null',
      );
      if (!isRecord(stored) || stored.accessToken !== expectedToken) return;
    }
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 存储不可用时仍清除内存会话。 */
  }
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

/** 提供可跨刷新恢复的认证上下文及过期清理。
 * @param props 子组件。
 * @returns 认证上下文 provider。
 * @throws 不适用；网络错误由公开操作返回调用方。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(restoreSession);
  const [notice, setNotice] = useState<SessionNotice>(null);
  const active = useRef<ActiveSession | null>(null);
  const initialized = useRef(false);

  // 一次性惰性初始化：把刷新前保存的会话绑定到新的请求生命周期。
  if (!initialized.current) {
    initialized.current = true;
    if (session)
      active.current = { data: session, controller: new AbortController() };
  }

  /** 取消旧会话后同步清缓存，禁止迟到请求恢复旧用户数据。
   * @param reason 登录页提示原因。
   * @returns 不适用。
   * @throws 不适用。
   */
  const logout = useCallback(
    (reason: SessionNotice = 'signed-out') => {
      const current = active.current;
      active.current?.controller.abort();
      active.current = null;
      if (current) clearPersistedSession(current.data.accessToken);
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
        persistSession(current.data, current.data.accessToken);
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
      persistSession(data);
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
      if (!current || current.data.expiresAt <= Date.now()) {
        if (current) logout('expired');
        throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      }
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
    [handleSessionError, logout],
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
      if (!current || current.data.expiresAt <= Date.now()) {
        if (current) logout('expired');
        throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      }
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
      () => {
        if (active.current?.data === session) logout('expired');
      },
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [session, logout]);

  useEffect(() => {
    /** 同步其他标签页的登录、退出和强制改密标记；读取最新值而非可能排队的事件值。
     * @param event 浏览器存储事件。
     * @returns 不适用。
     * @throws 不适用。
     */
    function syncSession(event: StorageEvent): void {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      try {
        if (event.storageArea !== localStorage) return;
      } catch {
        return; // 禁用存储时保留本标签页的内存会话。
      }
      const next = restoreSession();
      const current = active.current;
      if (next && current?.data.accessToken === next.accessToken) {
        current.data = next;
        setSession(next);
        return;
      }
      current?.controller.abort();
      active.current = next
        ? { data: next, controller: new AbortController() }
        : null;
      queryClient.clear();
      setSession(next);
      setNotice(next ? null : 'signed-out');
    }
    window.addEventListener('storage', syncSession);
    return () => window.removeEventListener('storage', syncSession);
  }, [queryClient]);

  // 不在卸载时中止请求：根 provider 只会被 StrictMode 模拟卸载，中止会让恢复的会话请求全部失败。

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
