// 定义上游事实错误，原始响应和凭据不进入错误摘要。
/** 上游调用失败的协议事实，不推断文件是否存在或变更是否生效。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class OpenListError extends Error {
  /** 创建服务控制的安全摘要。
   * @param code 固定原因码。
   * @param message 服务生成的诊断。
   * @param httpStatus 已收到的 HTTP 状态，未收到为 null。
   * @param upstreamCode 有效 envelope 的应用码，未收到为 null。
   * @param retryAfterMs 上游建议等待时间。
   * @param data 有效错误envelope的内部数据，只供端点验证，不暴露到日志或API。
   * @param dispatched 此请求是否可能已经到达远端；false表示尚未派发。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number | null = null,
    readonly upstreamCode: number | null = null,
    readonly retryAfterMs = 0,
    /** 有效envelope的内部data；仅供端点验证，不进入日志或API。 */
    readonly data: unknown = undefined,
    /** 请求是否可能已到达目标；false表示尚未派发。 */
    readonly dispatched = true,
  ) {
    super(message);
  }
}
/** 拒绝未知协议结构。
 * @param field 固定字段名称，不传入上游值。
 * @returns 不返回。
 * @throws OpenListError 协议异常。
 */
export function protocol(field: string): never {
  throw new OpenListError(
    'UPSTREAM_PROTOCOL_ERROR',
    `Invalid OpenList ${field}`,
  );
}
/** 验证未知 JSON 对象。
 * @param value 待验证值。
 * @returns 字符串键对象。
 * @throws OpenListError 非对象。
 */
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    protocol('object');
  return value as Record<string, unknown>;
}
/** 验证字符串。
 * @param value 未知字段。
 * @returns 原字符串。
 * @throws OpenListError 类型错误。
 */
export function string(value: unknown): string {
  if (typeof value !== 'string') protocol('string');
  return value;
}
/** 验证非负安全整数。
 * @param value 未知字段。
 * @returns 整数。
 * @throws OpenListError 数值错误。
 */
export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    protocol('integer');
  return value;
}
/** 验证布尔值。
 * @param value 未知字段。
 * @returns 布尔值。
 * @throws OpenListError 类型错误。
 */
export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') protocol('boolean');
  return value;
}
