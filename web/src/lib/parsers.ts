// 共享响应解析工具，每个 feature 的 contract 文件使用这些基础函数。
import { ApiError, isRecord } from './api-client';

/** 标准分页响应。
 * @template T 项类型。
 */
export interface Page<T> {
  /** 当前页数据。 */
  items: T[];
  /** 当前页号。 */
  page: number;
  /** 页大小。 */
  pageSize: number;
  /** 总记录数。 */
  total: number;
}

/** 解析分页响应，项解析委托给调用方。
 * @template T 项类型。
 * @param value 未信任的 JSON。
 * @param parseItem 项解析器。
 * @param label 错误提示中的资源名。
 * @returns 类型安全的分页结果。
 * @throws ApiError 响应不符合分页契约。
 */
export function parsePage<T>(
  value: unknown,
  parseItem: (item: unknown) => T,
  label: string,
): Page<T> {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    typeof value.page !== 'number' ||
    !Number.isSafeInteger(value.page) ||
    value.page < 1 ||
    typeof value.pageSize !== 'number' ||
    !Number.isSafeInteger(value.pageSize) ||
    value.pageSize < 1 ||
    value.pageSize > 200 ||
    typeof value.total !== 'number' ||
    !Number.isSafeInteger(value.total) ||
    value.total < 0
  ) {
    throw new ApiError(0, 'INVALID_RESPONSE', `Invalid ${label} list.`);
  }
  return {
    items: value.items.map(parseItem),
    page: value.page,
    pageSize: value.pageSize,
    total: value.total,
  };
}

/** 断言值是字符串，不擅自将缺失字段转换为空字符串。
 * @param value 待检查值。
 * @param field 字段名（用于错误提示）。
 * @returns 字符串值。
 * @throws ApiError 值不是字符串。
 */
export function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string')
    throw new ApiError(0, 'INVALID_RESPONSE', `Expected string for ${field}.`);
  return value;
}

/** 断言值是数字。
 * @param value 待检查值。
 * @param field 字段名。
 * @returns 数值。
 * @throws ApiError 值不是数字。
 */
export function expectNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new ApiError(0, 'INVALID_RESPONSE', `Expected number for ${field}.`);
  return value;
}

/** 断言值是布尔。
 * @param value 待检查值。
 * @param field 字段名。
 * @returns 布尔值。
 * @throws ApiError 值不是布尔。
 */
export function expectBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean')
    throw new ApiError(0, 'INVALID_RESPONSE', `Expected boolean for ${field}.`);
  return value;
}

/** 校验无响应体的 204，使归档操作也使用会话绑定的 request。
 * @param value 客户端提供的空响应标记。
 * @returns 不适用。
 * @throws ApiError 响应意外包含内容。
 */
export function parseEmpty(value: unknown): void {
  if (value !== undefined)
    throw new ApiError(0, 'INVALID_RESPONSE', 'Expected an empty response.');
}

/** 校验显式可空字符串，缺失字段不视作 null。
 * @param value 响应字段。
 * @param field 字段名称。
 * @returns 字符串或 null。
 * @throws ApiError 字段类型错误。
 */
export function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : expectString(value, field);
}

/** 校验显式可空数字。
 * @param value 响应字段。
 * @param field 字段名称。
 * @returns 有限数字或 null。
 * @throws ApiError 字段类型错误。
 */
export function nullableNumber(value: unknown, field: string): number | null {
  return value === null ? null : expectNumber(value, field);
}

/** 校验对象结构，避免不安全的类型断言将空值传到组件。
 * @param value 响应字段。
 * @param field 字段名称。
 * @returns 对象字段集合。
 * @throws ApiError 不是对象。
 */
export function expectRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!isRecord(value))
    throw new ApiError(0, 'INVALID_RESPONSE', `Expected object for ${field}.`);
  return value;
}

/** 校验有限状态值，未知状态不能被误认为终态或默认安全模式。
 * @template T 允许的字符串状态。
 * @param value 响应字段。
 * @param choices 当前协议允许的值。
 * @param field 字段名称。
 * @returns 已验证的状态。
 * @throws ApiError 状态不合法。
 */
export function expectEnum<T extends string>(
  value: unknown,
  choices: readonly T[],
  field: string,
): T {
  if (!choices.some((choice) => choice === value))
    throw new ApiError(0, 'INVALID_RESPONSE', `Invalid ${field}.`);
  return value as T;
}

/** 校验字符串数组，不静默丢弃异常字段。
 * @param value 响应字段。
 * @param field 字段名称。
 * @returns 字符串数组。
 * @throws ApiError 数组或项类型不符。
 */
export function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value))
    throw new ApiError(0, 'INVALID_RESPONSE', `Expected array for ${field}.`);
  return value.map((item) => expectString(item, field));
}

/** 校验非负安全整数统计，避免将协议错误显示成零或完成状态。
 * @param value 后端统计对象。
 * @returns 已验证统计。
 * @throws ApiError 统计结构或数值非法。
 */
export function parseStats(value: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(expectRecord(value, 'stats')).map(([key, raw]) => {
      const number = expectNumber(raw, `stats.${key}`);
      if (!Number.isSafeInteger(number) || number < 0)
        throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid statistics.');
      return [key, number];
    }),
  );
}

/** 校验公开诊断对象，禁止将异常错误响应静默转成无错误。
 * @param value 诊断对象或显式 null。
 * @returns 错误码、消息或 null。
 * @throws ApiError 诊断结构不合法。
 */
export function parseDiagnostic(
  value: unknown,
): { code: string; message: string } | null {
  if (value === null) return null;
  const error = expectRecord(value, 'diagnostic');
  return {
    code: expectString(error.code, 'code'),
    message: expectString(error.message, 'message'),
  };
}
