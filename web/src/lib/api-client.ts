// 请求同源管理 API，解析安全错误并保留取消语义；不持有或持久化 token。

/** 后端公开的字段验证错误。 */
export interface FieldError {
  /** 不含输入值的字段名。 */
  field: string;
  /** 后端公开的错误原因。 */
  reason: string;
}

/** 包含 HTTP 状态及后端诊断信息的请求错误。 */
export class ApiError extends Error {
  /** 创建安全的可展示请求错误。
   * @param status HTTP 状态；0 表示网络或响应协议错误。
   * @param code 后端错误码或客户端固定错误码。
   * @param message 可展示的错误说明，不包含原始响应体。
   * @param details 字段验证错误。
   * @param requestId 后端请求 ID，缺失为 null。
   * @param retryAfter 建议等待秒数，缺失为 null。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: FieldError[] = [],
    readonly requestId: string | null = null,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 所有请求共有的参数。 */
export interface RequestOptions {
  /** 特定端点以非 2xx 返回正常数据时允许的状态，例如健康检查的 503。 */
  acceptedStatuses?: readonly number[];
  /** 默认 GET；变更请求不自动重试。 */
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** 仅发送给当前源 /api/v1 的内存 token。 */
  token?: string;
  /** JSON 请求体，不传时不设置 Content-Type。 */
  body?: object;
  /** 组件或 Query 所有的取消信号。 */
  signal?: AbortSignal;
}

/** 需要通过运行时校验的 JSON 请求。
 * @template T 校验后的响应类型。
 */
export interface JsonRequestOptions<T> extends RequestOptions {
  /** 从 unknown 校验并投影公开字段；不直接信任 JSON。 */
  parse: (value: unknown) => T;
}

/** 判断未知 JSON 是否为非数组对象。
 * @param value 未信任的 JSON 值。
 * @returns 是否可以安全读取对象字段。
 * @throws 不适用。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 将 Retry-After 秒数或 HTTP 日期转换为非负等待秒数。
 * @param value 原始响应头；没有时为 null。
 * @returns 等待秒数；非法或缺失为 null。
 * @throws 不适用。
 */
function retrySeconds(value: string | null): number | null {
  if (value === null) return null;
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : null;
}

/** 请求 JSON 并通过调用方提供的校验器生成类型安全的数据。
 * @template T 响应类型。
 * @param path /api/v1 下以斜线开头的路径。
 * @param options 请求参数及响应校验器。
 * @returns 校验后的响应。
 * @throws ApiError 网络、HTTP 或响应格式错误；AbortError 请求已取消。
 */
export function apiRequest<T>(
  path: `/${string}`,
  options: JsonRequestOptions<T>,
): Promise<T>;
/** 请求只返回 204 的变更接口。
 * @param path /api/v1 下以斜线开头的路径。
 * @param options 请求参数，不提供 JSON 校验器。
 * @returns 请求完成，不解析空响应体。
 * @throws ApiError 网络、HTTP 或响应格式错误；AbortError 请求已取消。
 */
export function apiRequest(
  path: `/${string}`,
  options: RequestOptions,
): Promise<void>;
/** 执行请求并统一处理 HTTP、解析和取消边界。
 * @template T 响应校验结果。
 * @param path 当前 API 命名空间中的路径。
 * @param options 请求参数与可选校验器。
 * @returns 已校验 JSON 或 204 的 undefined。
 * @throws ApiError 请求失败；AbortError 请求已取消。
 */
export async function apiRequest<T>(
  path: `/${string}`,
  options: RequestOptions & { parse?: (value: unknown) => T },
): Promise<T | void> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  if (options.body !== undefined)
    headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method ?? 'GET',
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof DOMException && error.name === 'AbortError')
      throw error;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Unable to reach the server. Check your connection and try again.',
    );
  }
  options.signal?.throwIfAborted();
  if (response.status === 204) return options.parse?.(undefined);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    options.signal?.throwIfAborted();
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'The server returned an unexpected response.',
      [],
      response.headers.get('x-request-id'),
    );
  }
  options.signal?.throwIfAborted();
  if (!response.ok && !options.acceptedStatuses?.includes(response.status)) {
    const error =
      isRecord(payload) && isRecord(payload.error) ? payload.error : {};
    const details = Array.isArray(error.details)
      ? error.details.filter(
          (item: unknown): item is FieldError =>
            isRecord(item) &&
            typeof item.field === 'string' &&
            typeof item.reason === 'string',
        )
      : [];
    throw new ApiError(
      response.status,
      typeof error.code === 'string' ? error.code : 'HTTP_ERROR',
      typeof error.message === 'string'
        ? error.message
        : 'The request could not be completed.',
      details,
      response.headers.get('x-request-id'),
      retrySeconds(response.headers.get('retry-after')),
    );
  }
  if (!options.parse)
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'Expected an empty response.',
    );
  return options.parse(payload);
}
