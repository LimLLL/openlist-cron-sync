// 使用 undici 执行有界 JSON 请求；只对读取重试，禁止自动跳转。
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleDestroy } from '@nestjs/common';
import { Agent, request } from 'undici';
import { finished } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { AppConfig } from '../configuration/app-config.js';
import { Readiness } from '../coordination/coordination.module.js';
import { ApiQuota } from '../coordination/api-quota.service.js';
import type { ApiLimits } from '../coordination/api-quota.service.js';
import { errorTraits } from '../common/errors.js';
import type { RequestContext } from './request-context.js';
import { OpenListError, object, protocol } from './errors.js';

/** 单次协议调用参数。 */
export interface HttpCall extends RequestContext {
  /** 固定端点，查询参数必须单独编码；不记录到日志。 */
  endpoint: string;
  /** 固定 HTTP 方法。 */
  method: 'GET' | 'POST' | 'PUT';
  /** 仅读取可自动重试。 */
  read?: boolean;
  /** 控制请求优先。 */
  control?: boolean;
  /** JSON 请求值；undefined 不发送 body。 */
  json?: unknown;
  /** 上传字节；不自动重放。 */
  body?: Buffer;
  /** 已验证上传头，不允许日志输出。 */
  headers?: Record<string, string>;
  /** 父任务的取消或截止信号。 */
  signal?: AbortSignal;
  /** chunk/complete 由 relay 控制期限且不占 API 位。 */
  transfer?: boolean;
}
/** 实例网络配置。 */
export interface HttpInstance extends ApiLimits {
  /** 已规范化的实例地址。 */
  baseUrl: string;
}
/** 安全传输服务；不保存调用方凭据。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class OpenListTransport
  implements OnApplicationShutdown, OnModuleDestroy
{
  private readonly agents = new Map<number, Agent>();
  private readonly shutdown = new AbortController();
  private readonly logger = new Logger(OpenListTransport.name);
  /** 创建不带 redirect/retry interceptor 的连接池。
   * @param config 已验证配置。
   * @param quota 共享实例配额。
   * @param readiness 进程就绪状态；模块销毁时先广播关闭。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(ApiQuota) private readonly quota: ApiQuota,
    @Inject(Readiness) private readonly readiness: Readiness,
  ) {
    this.dispatcher(config.openlistConnectTimeoutMs);
  }
  /** 按实际建连期限共享连接池，旧 queued 快照不采用新进程期限。
   * @param connectTimeout 建连毫秒。
   * @returns 对应期限的连接池。
   * @throws 不适用。
   */
  private dispatcher(connectTimeout: number): Agent {
    let agent = this.agents.get(connectTimeout);
    if (!agent) {
      agent = new Agent({ connectTimeout, pipelining: 1 });
      this.agents.set(connectTimeout, agent);
    }
    return agent;
  }
  /** 执行请求与有界读取退避，认证恢复由上层处理。
   * @param instance 实例地址和配额。
   * @param call 请求协议。
   * @param token 裸 token；公开请求不传。
   * @returns 已验证 envelope 的 data，仍需端点验证。
   * @throws OpenListError 上游网络、HTTP 或协议错误。
   */
  async call(
    instance: HttpInstance,
    call: HttpCall,
    token?: string,
  ): Promise<unknown> {
    const settings = call.settings ?? this.config.execution;
    if (call.transfer && !call.signal)
      throw new Error('Transfer requests require a deadline signal');
    const deadlineAt = call.transfer
      ? Infinity
      : Date.now() + settings.apiTimeoutMs;
    const timeout = call.transfer
      ? call.signal
      : AbortSignal.timeout(settings.apiTimeoutMs);
    const signals = [this.shutdown.signal];
    if (timeout) signals.push(timeout);
    if (call.signal) signals.push(call.signal);
    const signal = AbortSignal.any(signals);
    const attempts = call.read ? settings.retryMaxAttempts : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.once(instance, call, token, signal);
      } catch (error) {
        if (!(error instanceof OpenListError)) throw error;
        const status = error.upstreamCode ?? error.httpStatus;
        const retryable =
          error.code === 'OPENLIST_ERROR' &&
          (status === null ||
            status === 429 ||
            (status >= 500 && status <= 599));
        if (!retryable || signal.aborted || attempt >= attempts) {
          this.logger.warn('OpenList request failed', {
            instanceId: instance.id,
            errorCode: error.code,
            httpStatus: error.httpStatus,
            upstreamCode: error.upstreamCode,
          });
          throw error;
        }
        const backoff = Math.min(
          settings.retryMaxMs,
          settings.retryBaseMs * 2 ** (attempt - 1) * (0.5 + Math.random()),
        );
        const waitMs = Math.max(backoff, error.retryAfterMs);
        // 超出请求期限时直接结束，避免巨大 Retry-After 溢出 Node 定时器并提前重试。
        if (waitMs >= deadlineAt - Date.now()) throw error;
        try {
          await delay(waitMs, undefined, {
            signal,
          });
        } catch (cause) {
          this.logger.warn('OpenList retry deadline reached', {
            instanceId: instance.id,
            ...errorTraits(cause),
          });
          throw error;
        }
      }
    }
  }
  /** 执行一次 HTTP 请求，并在释放名额前完整消费受限响应。
   * @param instance 实例配置。
   * @param call 请求参数。
   * @param token 裸 token。
   * @param signal 请求期限。
   * @returns data。
   * @throws OpenListError 协议或传输失败。
   */
  private async once(
    instance: HttpInstance,
    call: HttpCall,
    token: string | undefined,
    signal: AbortSignal,
  ): Promise<unknown> {
    const settings = call.settings ?? this.config.execution;
    let release: (() => void) | undefined;
    try {
      if (!call.transfer)
        release = await this.quota.acquire(
          instance,
          call.control ?? true,
          signal,
        );
      signal.throwIfAborted();
      const headers: Record<string, string> = {
        accept: 'application/json',
        ...call.headers,
      };
      if (token !== undefined) headers.authorization = token;
      if (call.json !== undefined) headers['content-type'] = 'application/json';
      const response = await request(instance.baseUrl + call.endpoint, {
        dispatcher: this.dispatcher(settings.connectTimeoutMs),
        idempotent: false,
        method: call.method,
        headers,
        body: call.json === undefined ? call.body : JSON.stringify(call.json),
        signal,
        headersTimeout: call.transfer ? 0 : settings.apiTimeoutMs,
        bodyTimeout: call.transfer ? 0 : settings.apiTimeoutMs,
      });
      try {
        const status = response.statusCode;
        const retryAfter = retryAfterMs(response.headers['retry-after']);
        if (status >= 300 && status < 400)
          throw new OpenListError(
            'UPSTREAM_REDIRECT',
            'OpenList API redirect refused',
            status,
          );
        if (status < 200 || status >= 300)
          throw new OpenListError(
            'OPENLIST_ERROR',
            `OpenList HTTP ${status}`,
            status,
            null,
            retryAfter,
          );
        const type = response.headers['content-type'];
        if (
          typeof type !== 'string' ||
          !/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(type)
        )
          protocol('content type');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const part of response.body) {
          const chunk: unknown = part;
          if (!Buffer.isBuffer(chunk)) protocol('body chunk');
          size += chunk.length;
          if (size > settings.maxJsonBytes)
            throw new OpenListError(
              'UPSTREAM_JSON_TOO_LARGE',
              'OpenList JSON exceeds byte limit',
              status,
            );
          chunks.push(chunk);
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          protocol('JSON');
        }
        const envelope = object(parsed);
        if (
          typeof envelope.code !== 'number' ||
          !Number.isSafeInteger(envelope.code) ||
          typeof envelope.message !== 'string' ||
          !Object.hasOwn(envelope, 'data')
        )
          protocol('envelope');
        if (envelope.code !== 200)
          throw new OpenListError(
            'OPENLIST_ERROR',
            `OpenList application code ${envelope.code}`,
            status,
            envelope.code,
            retryAfter,
          );
        return envelope.data;
      } finally {
        // 未完整消费的错误响应立即销毁，绝不为读取错误正文占用连接。
        if (!response.body.readableEnded) {
          const closed = finished(response.body, { cleanup: true });
          response.body.destroy();
          try {
            await closed;
          } catch (error) {
            this.logger.debug('OpenList response stream closed early', {
              instanceId: instance.id,
              ...errorTraits(error),
            });
          }
        }
      }
    } catch (error) {
      if (error instanceof OpenListError) throw error;
      this.logger.debug('OpenList transport unavailable', {
        instanceId: instance.id,
        ...errorTraits(error),
      });
      throw new OpenListError(
        'OPENLIST_ERROR',
        signal.aborted
          ? 'OpenList request deadline or cancellation'
          : 'OpenList network request failed',
      );
    } finally {
      release?.();
    }
  }
  /** 在数据库关闭前取消在途请求与尚未取得配额的等待。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  onModuleDestroy(): void {
    this.readiness.beginShutdown();
    this.shutdown.abort();
  }
  /** 应用退出时销毁连接池与在途请求。
   * @param 不适用。
   * @returns 关闭完成。
   * @throws Error 关闭失败。
   */
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      [...this.agents.values()].map(
        /** 销毁一个建连期限对应的连接池及其在途请求。
         * @param agent 已创建的连接池。
         * @returns 关闭完成的 Promise。
         * @throws 不适用；关闭失败由返回的 Promise 拒绝。
         */
        (agent) => agent.destroy(),
      ),
    );
    this.agents.clear();
  }
}
/** 解析 Retry-After 的秒数或 HTTP 日期。
 * @param value 原始响应头。
 * @returns 非负等待毫秒；非法值为零。
 * @throws 不适用。
 */
function retryAfterMs(value: string | string[] | undefined): number {
  if (typeof value !== 'string') return 0;
  const milliseconds = /^\d+$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0;
}
