// 受控下载、按需求计时和Range恢复；不持久化下载URL或签名。
import { Logger } from '@nestjs/common';
import { finished } from 'node:stream/promises';
import { Agent, request } from 'undici';
import type { Dispatcher } from 'undici';
import type { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { InstanceRecord } from '../database/schema.js';
import type { ExecutionSettings } from '../configuration/execution-settings.js';
import type { OpenListClient } from '../openlist/client.service.js';
import { downloadUrl } from '../openlist/paths.js';
import { backoffMs } from '../common/backoff.js';
import { RelayError } from './errors.js';

/** 下载固定参数；凭据不进入URL或日志。 */
export interface DownloadInput {
  /** 当时连接身份及当前有效凭据。 */
  instance: InstanceRecord;
  /** 账号内父目录。 */
  directory: string;
  /** 原始合法文件名。 */
  name: string;
  /** 已计划的精确大小。 */
  size: number;
  /** 当前Run路径密码。 */
  password: string;
  /** 固定期限和重试设置。 */
  settings: ExecutionSettings;
  /** 总期限与停止信号。 */
  signal: AbortSignal;
}
/** 一个文件的GET连接，内存仅保留当前网络缓冲。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class Download {
  private readonly agent: Agent;
  private readonly stop = new AbortController();
  private closing?: Promise<void>;
  private reading?: Promise<Buffer>;
  /** 合并文件期限与源独立停止信号后的输入。 */
  readonly input: DownloadInput;
  /** 已验证精确长度和正常EOF；独立于Operation的持久化检查点。 */
  verifiedEOF = false;
  private readonly logger = new Logger(Download.name);
  private streamError: unknown;
  private body?: Readable;
  private iterator?: AsyncIterator<unknown>;
  private buffered: Buffer = Buffer.alloc(0);
  private offset = 0;
  private validator?: string;
  private sign = '';
  private resumed = 0;
  private signedAgain = false;
  downloadedBytes = 0;
  /** 保存调用上下文并建立本文件连接池。
   * @param input 固定下载配置。
   * @param client 共享认证文件客户端，用于获得短期sign。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    input: DownloadInput,
    private readonly client: OpenListClient,
  ) {
    this.input = {
      ...input,
      signal: AbortSignal.any([input.signal, this.stop.signal]),
    };
    this.agent = new Agent({
      connectTimeout: input.settings.connectTimeoutMs,
      pipelining: 1,
    });
  }
  /** 准入时获取sign，验证读取对象仍满足计划前提。
   * @param 不适用。
   * @returns GET已打开。
   * @throws RelayError 源已变化；OpenListError 读取或认证失败。
   */
  async open(): Promise<void> {
    const { instance, directory, name, password, signal, settings, size } =
      this.input;
    const entry = await this.client.get(instance, directory, name, password, {
      signal,
      settings,
    });
    if (entry.name !== name || entry.isDir || entry.size !== size)
      throw new RelayError('SOURCE_CHANGED');
    this.sign = entry.sign;
    await this.connect();
  }
  /** 打开或恢复GET；手动逐跳处理，不发送管理token。
   * @param 不适用。
   * @returns 已取得合法的最终响应体。
   * @throws RelayError HTTP、validator或长度不满足计划。
   */
  private async connect(): Promise<void> {
    const { instance, directory, name, size, signal, settings } = this.input;
    let url = downloadUrl(
      instance.baseUrl,
      instance.accountBasePath ?? '/',
      directory,
      name,
      this.sign,
      instance.downloadMode,
    );
    const headers: Record<string, string> = { 'accept-encoding': 'identity' };
    if (this.offset) {
      headers.range = `bytes=${this.offset}-`;
      if (this.validator) headers['if-range'] = this.validator;
    }
    for (let redirects = 0; ; redirects++) {
      signal.throwIfAborted();
      let response: Dispatcher.ResponseData;
      try {
        response = await request(url, {
          dispatcher: this.agent,
          method: 'GET',
          headers,
          signal,
          headersTimeout: settings.apiTimeoutMs,
          bodyTimeout: 0,
        });
      } catch (error) {
        signal.throwIfAborted();
        this.logger.debug('Download connection unavailable', {
          errorName: error instanceof Error ? error.name : 'Unknown',
        });
        throw new RelayError(
          'OPENLIST_ERROR',
          'Download connection unavailable',
          true,
        );
      }
      if (response.statusCode >= 300 && response.statusCode < 400) {
        await this.drop(response.body);
        const location = response.headers.location;
        if (redirects >= 5 || typeof location !== 'string')
          throw new RelayError('UPSTREAM_REDIRECT');
        const previous = new URL(url);
        let next: URL;
        try {
          next = new URL(location, previous);
        } catch {
          throw new RelayError(
            'UPSTREAM_REDIRECT',
            'Invalid download redirect',
          );
        }
        if (
          !['http:', 'https:'].includes(next.protocol) ||
          next.username ||
          next.password ||
          (previous.protocol === 'https:' && next.protocol === 'http:')
        )
          throw new RelayError('UPSTREAM_REDIRECT');
        if (previous.origin !== next.origin) {
          delete headers.authorization;
          delete headers.cookie;
          delete headers['proxy-authorization'];
        }
        url = next.href;
        continue;
      }
      if (response.statusCode === 401 && redirects === 0 && !this.signedAgain) {
        await this.drop(response.body);
        this.signedAgain = true;
        const listing = await this.client.list(
          instance,
          directory,
          this.input.password,
          false,
          { signal, settings },
        );
        const entry = listing.items.find(
          /** 从重新列出的源目录中查找原名。
           * @param item 当前待检查值。
           * @returns 是否为计划源文件。
           * @throws 不适用。
           */
          (item) => item.name === name,
        );
        if (!entry || entry.isDir || entry.size !== size)
          throw new RelayError('SOURCE_CHANGED');
        this.sign = entry.sign;
        return this.connect();
      }
      try {
        this.validate(response);
      } catch (error) {
        await this.drop(response.body);
        throw error;
      }
      this.streamError = undefined;
      this.body = response.body;
      response.body.on(
        'error',
        /** 保留当前下载流错误供下一次读取及Range恢复处理。
         * @param error 原始错误，仅转换为受控结果或安全特征。
         * @returns 不适用。
         * @throws 不适用。
         */
        (error: Error) => {
          if (this.body === response.body) this.streamError = error;
        },
      );
      this.iterator = response.body[Symbol.asyncIterator]();
      this.buffered = Buffer.alloc(0);
      if (this.offset && response.statusCode === 200)
        await this.discard(this.offset);
      return;
    }
  }
  /** 校验identity、Range以及强validator；不猜测Content-Type。
   * @param response 最终HTTP响应。
   * @returns 不适用。
   * @throws RelayError 协议或源前提变化。
   */
  private validate(response: Dispatcher.ResponseData): void {
    const { size } = this.input;
    const status = response.statusCode;
    if (status === 416) throw new RelayError('SOURCE_CHANGED');
    if (status !== 200 && !(this.offset && status === 206))
      throw new RelayError(
        'OPENLIST_ERROR',
        `Download HTTP ${status}`,
        status >= 500 || status === 429,
      );
    const encoding = response.headers['content-encoding'];
    if (encoding !== undefined && encoding !== 'identity')
      throw new RelayError(
        'UPSTREAM_PROTOCOL_ERROR',
        'Download content encoding refused',
      );
    const etag = response.headers.etag;
    if (this.validator && etag !== undefined && etag !== this.validator)
      throw new RelayError('SOURCE_CHANGED');
    if (!this.offset && typeof etag === 'string' && /^".*"$/.test(etag))
      this.validator = etag;
    const length = response.headers['content-length'];
    const expected = status === 206 ? size - this.offset : size;
    if (
      length !== undefined &&
      (!/^\d+$/.test(String(length)) || Number(length) !== expected)
    )
      throw new RelayError(this.offset ? 'SOURCE_CHANGED' : 'SIZE_MISMATCH');
    if (status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
        String(response.headers['content-range']),
      );
      if (
        !range ||
        Number(range[1]) !== this.offset ||
        Number(range[2]) !== size - 1 ||
        Number(range[3]) !== size
      )
        throw new RelayError('SOURCE_CHANGED');
    }
  }
  /** 仅在实际索取网络数据时运行idle时钟。
   * @param 不适用。
   * @returns 下一缓冲；EOF为null。
   * @throws Error 网络错误或取消；RelayError 非字节响应。
   */
  private async next(): Promise<Buffer | null> {
    this.input.signal.throwIfAborted();
    if (this.streamError) throw this.streamError;
    const iterator = this.iterator;
    if (!iterator)
      throw new RelayError(
        'OPENLIST_ERROR',
        'Download connection missing',
        true,
      );
    const timer = setTimeout(
      /** 仅在源读取等待超时后中止当前GET。
       * @param 不适用。
       * @returns 不适用。
       * @throws 不适用。
       */
      () =>
        this.body?.destroy(
          new RelayError('OPENLIST_ERROR', 'Download idle timeout', true),
        ),
      this.input.settings.relayIdleTimeoutSeconds * 1000,
    );
    try {
      const part = await iterator.next();
      if (part.done) return null;
      if (!Buffer.isBuffer(part.value))
        throw new RelayError('UPSTREAM_PROTOCOL_ERROR');
      this.downloadedBytes += part.value.length;
      if (!Number.isSafeInteger(this.downloadedBytes))
        throw new RelayError('RESOURCE_LIMIT');
      return part.value;
    } finally {
      clearTimeout(timer);
    }
  }
  /** 精确消费不超过请求长度的字节，剩余网络缓冲留待后续块。
   * @param length 本次要求字节数。
   * @returns 已读payload，正常EOF可短于要求。
   * @throws Error 网络读取失败。
   */
  private async consume(length: number): Promise<Buffer> {
    const parts: Buffer[] = [];
    let received = 0;
    while (received < length) {
      if (!this.buffered.length) {
        const next = await this.next();
        if (next === null) break;
        this.buffered = next;
      }
      const n = Math.min(length - received, this.buffered.length);
      parts.push(this.buffered.subarray(0, n));
      this.buffered = this.buffered.subarray(n);
      received += n;
    }
    return Buffer.concat(parts, received);
  }
  /** 对忽略Range的响应丢弃已完成前缀，内存仍有界。
   * @param bytes 已完成前缀字节数。
   * @returns 丢弃完成。
   * @throws RelayError 响应短于已完成前缀。
   */
  private async discard(bytes: number): Promise<void> {
    while (bytes) {
      const part = await this.consume(Math.min(65536, bytes));
      if (!part.length) throw new RelayError('SIZE_MISMATCH');
      bytes -= part.length;
    }
  }
  /** 读取一个完整块；断连时仅从最后完成的块偏移恢复。
   * @param length 请求字节数，EOF探测时为1。
   * @returns 数据，正常EOF可返回空缓冲。
   * @throws RelayError 长度/源变化或重试耗尽；Error 取消。
   */
  async take(length: number): Promise<Buffer> {
    this.input.signal.throwIfAborted();
    const reading = this.read(length);
    this.reading = reading;
    try {
      return await reading;
    } finally {
      this.reading = undefined;
    }
  }
  /** 执行一次读取及其Range恢复；外层take负责登记活动读取供close等待。
   * @param length 请求字节数。
   * @returns 本次读取到的数据。
   * @throws RelayError 读取失败；Error 取消。
   */
  private async read(length: number): Promise<Buffer> {
    let reconnect = false;
    for (;;) {
      try {
        // 续传重连本身的瞬时失败与读取失败共用同一续传预算。
        if (reconnect) await this.connect();
        reconnect = false;
        const data = await this.consume(length);
        this.offset += data.length;
        return data;
      } catch (error) {
        this.input.signal.throwIfAborted();
        if (error instanceof RelayError && !error.retryable) throw error;
        if (++this.resumed >= this.input.settings.retryMaxAttempts)
          throw new RelayError(
            'OPENLIST_ERROR',
            'Download retries exhausted',
            true,
          );
        this.body?.destroy();
        await delay(backoffMs(this.input.settings, this.resumed), undefined, {
          signal: this.input.signal,
        });
        reconnect = true;
      }
    }
  }
  /** 验证已消费精确大小且源正常结束；已经验证时不再探测已关闭的连接。
   * @param 不适用。
   * @returns EOF事实已确认。
   * @throws RelayError 长度不匹配或读取失败；Error 取消。
   */
  async verifyEOF(): Promise<void> {
    if (this.verifiedEOF) return;
    if (this.offset !== this.input.size || (await this.take(1)).length)
      throw new RelayError('SIZE_MISMATCH');
    this.verifiedEOF = true;
  }
  /** 停止源请求和Range退避，不取消目标的独立收尾请求。
   * @param reason 首个流水线失败或取消原因。
   * @returns 不适用。
   * @throws 不适用。
   */
  cancel(reason?: unknown): void {
    this.stop.abort(reason);
    this.body?.destroy();
  }
  /** 安全销毁尚未建立迭代器的错误/跳转响应。
   * @param body 需要关闭的响应流。
   * @returns 流已关闭。
   * @throws 不适用；主动销毁的流错误仅记录安全类型。
   */
  private async drop(body: Readable): Promise<void> {
    const closed = finished(body, { cleanup: true });
    body.destroy();
    try {
      await closed;
    } catch (error) {
      this.logger.debug('Download response closed', {
        errorName: error instanceof Error ? error.name : 'Unknown',
      });
    }
  }
  /** 关闭body和连接池，避免未消费响应泄漏socket。
   * @param 不适用。
   * @returns 本地连接已退出。
   * @throws Error 连接池销毁失败。
   */
  close(): Promise<void> {
    this.closing ??= this.closeReader();
    return this.closing;
  }
  /** 销毁连接池并等待当前读取退出，再丢弃网络缓冲及流引用。
   * @param 不适用。
   * @returns 源已停止，调用方可安全归还并发位。
   * @throws Error 连接池销毁失败。
   */
  private async closeReader(): Promise<void> {
    this.cancel();
    // 读取的错误仍由原take调用方分类；这里仅等待它退出，避免释放配额后旧读取仍活动。
    const settled = this.reading
      ? Promise.allSettled([this.reading])
      : undefined;
    try {
      await this.agent.destroy();
    } finally {
      await settled;
      this.body = undefined;
      this.iterator = undefined;
      this.buffered = Buffer.alloc(0);
    }
  }
}
