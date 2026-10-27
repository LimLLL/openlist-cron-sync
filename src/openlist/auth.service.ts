// 共享内存 token 与 single-flight 登录；持久阻断由安全模块管理。
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BeforeApplicationShutdown } from '@nestjs/common';
import { errorTraits } from '../common/errors.js';
import { createHash } from 'node:crypto';
import { AppConfig } from '../configuration/app-config.js';
import { KeysService } from '../security/keys.service.js';
import {
  InstanceAuthState,
  sameConnection,
} from '../security/instance-auth-state.service.js';
import type { InstanceRecord } from '../database/schema.js';
import { ApiError } from '../common/errors.js';
import { OpenListTransport } from './transport.service.js';
import type { HttpCall } from './transport.service.js';
import { OpenListError, object, string, integer, protocol } from './errors.js';
import { waitForAuthentication } from './request-context.js';
import type { RequestContext } from './request-context.js';
import { normalizeGlobalPath } from './paths.js';

/** 已核对的账号身份。 */
export interface Account {
  /** 上游用户名。 */
  username: string;
  /** 规范化全局根。 */
  basePath: string;
  /** 上游角色：0 普通、1 guest、2 管理员。 */
  role: number;
  /** 原始权限位图。 */
  permissions: number;
}
/** 内存会话；从不落库或返回 API。 */
interface Session {
  /** 本次连接配置。 */
  instance: InstanceRecord;
  /** 一次成功认证发布的 token；以对象身份区分上游可能重复签发的相同 JWT。 */
  token?: {
    /** JWT 或静态 token 原文，不持久化、不记录日志。 */
    value: string;
  };
  /** 最近已确认账号。 */
  account?: Account;
  /** 同一个失效 token 的恢复过程。 */
  flight?: Promise<void>;
}
/** 统一认证入口，所有客户端调用共享此状态机。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class OpenListAuth implements BeforeApplicationShutdown {
  private readonly flights = new Set<Promise<void>>();
  private readonly logger = new Logger(OpenListAuth.name);
  private readonly sessions = new Map<string, Session>();
  /** 保存已授权的依赖。
   * @param transport 单请求传输。
   * @param states 持久认证状态。
   * @param keys 凭据解密。
   * @param config 冷却参数。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(OpenListTransport) private readonly transport: OpenListTransport,
    @Inject(InstanceAuthState) private readonly states: InstanceAuthState,
    @Inject(KeysService) private readonly keys: KeysService,
    @Inject(AppConfig) private readonly config: AppConfig,
  ) {}

  /** 数据库关闭前等待共享认证完成，调用方取消不使认证变成悬空工作。
   * @param 不适用。
   * @returns 全部已开始认证停止。
   * @throws 不适用；停止时的网络失败记录安全摘要。
   */
  async beforeApplicationShutdown(): Promise<void> {
    for (const result of await Promise.allSettled(this.flights))
      if (result.status === 'rejected')
        this.logger.debug(
          'Authentication stopped during shutdown',
          errorTraits(result.reason),
        );
  }
  /** 准备一次显式人工恢复；429 冷却期间拒绝且不触网。
   * 持久阻断保持不变，直到随后的人工尝试成功，网络失败不会解除阻断。
   * @param instance 调用配置。
   * @returns 不适用。
   * @throws ApiError 冷却中或配置变化。
   */
  retryManually(instance: InstanceRecord): void {
    const current = this.states.current(instance);
    if (
      current.authBlockedUntil !== null &&
      current.authBlockedUntil > Date.now()
    )
      throw new ApiError(
        409,
        'AUTH_COOLDOWN',
        'OpenList authentication cooldown is active',
      );
    // 丢弃旧会话，使随后的人工 account 调用必定重新登录并核对 /me。
    const session = this.sessions.get(instance.id);
    if (!session?.flight) this.sessions.delete(instance.id);
  }
  /** 执行认证请求；401 后按失效 token 合并重新登录，并重放一次不带上传 body 的请求。
   * @param instance 调用配置。
   * @param call 协议参数。
   * @returns 上游 data。
   * @throws OpenListError 认证阻断或上游失败；Error 持久化失败。
   */
  async call(instance: InstanceRecord, call: HttpCall): Promise<unknown> {
    const waiting = call.dispatchSignal
      ? AbortSignal.any([
          call.dispatchSignal,
          ...(call.signal ? [call.signal] : []),
        ])
      : call.signal;
    waiting?.throwIfAborted();
    const session = await waitForAuthentication(
      this.ready(instance, false, call),
      waiting,
    );
    const token = session.token;
    try {
      return await this.transport.call(instance, call, token?.value);
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
      if (instance.authMode === 'token') {
        this.states.block(instance, 'TOKEN_401', null);
        throw new OpenListError(
          'AUTH_BLOCKED',
          'OpenList static token rejected',
        );
      }
      if (call.body !== undefined) {
        // 上传 body 不在 HTTP 层重放；下一次真实调用先恢复认证。
        if (session.token === token) session.account = undefined;
        throw error;
      }
      // 上游只在认证中间件或处理器入口的身份检查返回 401，请求尚未执行，重放一次是安全的。
      await waitForAuthentication(
        this.refresh(session, token, false, call),
        waiting,
      );
      return this.transport.call(
        instance,
        { ...call, read: false },
        session.token?.value,
      );
    }
  }
  /** 获取身份；连接测试强制重新读取 /me。
   * @param instance 调用配置。
   * @param force 是否强制刷新身份。
   * @param manual 是否为 retryManually 之后的单次人工尝试，可越过持久阻断。
   * @param context 调用方的中止信号与 Run 固定参数；省略时使用进程配置。
   * @returns 已核对账号。
   * @throws OpenListError 认证或协议失败。
   */
  async account(
    instance: InstanceRecord,
    force = false,
    manual = false,
    context: RequestContext = {},
  ): Promise<Account> {
    const existing = this.sessions.get(instance.id);
    const hadAccount =
      existing?.account !== undefined &&
      sameConnection(existing.instance, instance);
    context.signal?.throwIfAborted();
    const session = await waitForAuthentication(
      this.ready(instance, manual, context),
      context.signal,
    );
    if (force && hadAccount) {
      const data = await this.call(instance, {
        ...context,
        endpoint: '/api/me',
        method: 'GET',
        read: true,
      });
      // 在途旧 /me 的成功不能解除其间产生的持久阻断；解除只由获准的新认证完成。
      this.assertAllowed(instance);
      session.account = this.acceptAccount(instance, data);
    }
    if (!session.account) protocol('account');
    return session.account;
  }
  /** 凭据更新或归档后释放旧会话。
   * @param id 实例 ID。
   * @returns 不适用。
   * @throws 不适用。
   */
  forget(id: string): void {
    this.sessions.delete(id);
  }

  /** 本地检查持久阻断并取得经过 /me 核对的会话。
   * @param instance 调用配置。
   * @param manual 是否为单次人工尝试。
   * @param context 需要登录时传给共享登录的调用方上下文，仅使用其 Run 固定参数。
   * @returns 可用会话。
   * @throws OpenListError 阻断或认证失败。
   */
  private async ready(
    instance: InstanceRecord,
    manual = false,
    context: RequestContext = {},
  ): Promise<Session> {
    this.assertAllowed(instance, manual);
    let session = this.sessions.get(instance.id);
    if (!session || !sameConnection(session.instance, instance)) {
      session = { instance };
      this.sessions.set(instance.id, session);
    }
    if (!session.account)
      await this.refresh(session, session.token, manual, context);
    return session;
  }
  /** 检查阻断，不在冷却期内访问任何上游端点。
   * @param instance 请求配置。
   * @param manual 人工尝试越过持久阻断；冷却由 retryManually 先行拒绝，缺凭据仍阻断。
   * @returns 不适用。
   * @throws OpenListError 认证阻断。
   */
  assertAllowed(instance: InstanceRecord, manual = false): void {
    const current = this.states.current(instance);
    if (
      !manual &&
      current.authState === 'auth_blocked' &&
      (current.authBlockedUntil === null ||
        current.authBlockedUntil > Date.now())
    )
      throw new OpenListError(
        'AUTH_BLOCKED',
        'OpenList authentication is blocked',
      );
    if (!current.secretEnc) {
      this.states.block(instance, 'MISSING_SECRET', null);
      throw new OpenListError(
        'AUTH_BLOCKED',
        'OpenList credentials are missing',
      );
    }
  }
  /** 以失效 token 为条件合并恢复，晚到的 401 不重新登录。
   * @param session 同连接会话。
   * @param stale 请求使用的 token 发布对象；相同 JWT 字节也可能属于不同登录。
   * @param manual 是否为单次人工尝试。
   * @param context 发起登录的调用方上下文，仅使用其 Run 固定参数。
   * @returns 恢复完成。
   * @throws OpenListError 登录或身份验证失败。
   */
  private async refresh(
    session: Session,
    stale: Session['token'],
    manual = false,
    context: RequestContext = {},
  ): Promise<void> {
    this.assertAllowed(session.instance, manual);
    const current = this.sessions.get(session.instance.id);
    // 人工重试或相同地址的 PATCH 会重建缓存；旧请求仍须复用当前连接的恢复过程。
    if (
      current &&
      current !== session &&
      sameConnection(current.instance, session.instance)
    ) {
      await this.refresh(current, stale, manual, context);
      session.token = current.token;
      session.account = current.account;
      return;
    }
    if (session.token !== stale && session.account) return;
    if (session.flight) return session.flight;
    session.account = undefined;
    const flight = this.loginAndIdentify(session, context);
    session.flight = flight;
    this.flights.add(flight);
    try {
      await flight;
    } finally {
      this.flights.delete(flight);
      if (session.flight === flight) session.flight = undefined;
    }
  }
  /** 单次登录并核对身份，不对登录请求自动重试。
   * @param session 当前会话。
   * @param context 发起登录的调用方上下文；仅取 settings 决定请求参数与 429 冷却时长，不传递调用方信号。
   * @returns 身份确认完成。
   * @throws OpenListError 登录失败；Error 解密或数据库失败。
   */
  private async loginAndIdentify(
    session: Session,
    context: RequestContext,
  ): Promise<void> {
    const instance = session.instance;
    const secretEnc = instance.secretEnc;
    if (!secretEnc)
      throw new OpenListError(
        'AUTH_BLOCKED',
        'OpenList credentials are missing',
      );
    const secret = this.keys.decrypt(secretEnc, {
      table: 'instances',
      recordId: instance.id,
      field: 'secret_enc',
    });
    let token = secret;
    if (instance.authMode === 'password') {
      try {
        const data = object(
          await this.transport.call(instance, {
            settings: context.settings,
            cleanup: context.cleanup,
            endpoint: '/api/auth/login/hash',
            method: 'POST',
            json: {
              username: instance.username,
              password: createHash('sha256')
                .update(secret + '-https://github.com/alist-org/alist')
                .digest('hex'),
            },
          }),
        );
        token = string(data.token);
        if (!token || /[^\x21-\x7e]/u.test(token)) protocol('login token');
      } catch (error) {
        if (!(error instanceof OpenListError)) throw error;
        const status = error.upstreamCode ?? error.httpStatus;
        if (status === 401 || status === 402 || status === 429) {
          this.states.block(
            instance,
            `LOGIN_${status}`,
            status === 429
              ? Date.now() +
                  (context.settings ?? this.config.execution)
                    .authCooldownSeconds *
                    1000
              : null,
          );
          throw new OpenListError(
            'AUTH_BLOCKED',
            `OpenList login rejected (${status})`,
            error.httpStatus,
            error.upstreamCode,
          );
        }
        throw error;
      }
    }
    // 发布 token 之前先确认 /me，guest 永远不能成为可用会话。
    try {
      const data = await this.transport.call(
        instance,
        {
          endpoint: '/api/me',
          method: 'GET',
          read: true,
          settings: context.settings,
          cleanup: context.cleanup,
        },
        token,
      );
      session.account = this.acceptAccount(instance, data);
      session.token = { value: token };
    } catch (error) {
      session.account = undefined;
      if (isUnauthorized(error)) {
        this.states.block(
          instance,
          instance.authMode === 'token' ? 'TOKEN_401' : 'LOGIN_401',
          null,
        );
        throw new OpenListError(
          'AUTH_BLOCKED',
          'OpenList account authentication rejected',
          error.httpStatus,
          error.upstreamCode,
        );
      }
      throw error;
    }
  }
  /** 校验每个 /me 成功响应并按责任谓词保存身份。
   * @param instance 请求配置。
   * @param input 上游 data。
   * @returns 已验证身份。
   * @throws OpenListError guest 或结构异常；Error 数据库失败。
   */
  private acceptAccount(instance: InstanceRecord, input: unknown): Account {
    const data = object(input);
    let basePath: string;
    try {
      basePath = normalizeGlobalPath(string(data.base_path));
    } catch {
      return protocol('account base_path');
    }
    const account = {
      username: string(data.username),
      basePath,
      role: integer(data.role),
      permissions: integer(data.permission),
    };
    if (
      !account.username ||
      account.role > 2 ||
      account.permissions > 2147483647
    )
      protocol('account');
    if (account.role === 1) {
      this.states.block(instance, 'GUEST', null);
      throw new OpenListError(
        'AUTH_BLOCKED',
        'OpenList guest account is not authenticated',
        200,
        200,
      );
    }
    if (!this.states.identify(instance, account))
      throw new OpenListError(
        'AUTH_BLOCKED',
        'OpenList account identity changed',
      );
    return account;
  }
}
/** 判断真实或 envelope 认证拒绝，不读取 message。
 * @param error 调用异常。
 * @returns 是否为 401。
 * @throws 不适用。
 */
function isUnauthorized(error: unknown): error is OpenListError {
  return (
    error instanceof OpenListError &&
    (error.upstreamCode ?? error.httpStatus) === 401
  );
}
