// 严格解析环境值，所有错误只包含字段名称。
import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import { StartupError } from '../common/errors.js';

/** 环境输入；键为变量名，值为原始字符串或未设置。 */
export type Environment = Readonly<Record<string, string | undefined>>;

/** 拒绝非法配置而不泄漏其值。
 * @param field 非法字段名。
 * @returns 不返回。
 * @throws StartupError 始终抛出配置错误。
 */
export function invalidConfig(field: string): never {
  throw new StartupError('VALIDATION_ERROR', `Invalid configuration: ${field}`);
}

/** 读取有界十进制整数。
 * @param env 环境。
 * @param name 字段名。
 * @param fallback 默认值。
 * @param min 最小值。
 * @param max 最大值。
 * @returns 有效整数。
 * @throws StartupError 值非法。
 */
export function integerSetting(
  env: Environment,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) return invalidConfig(name);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    return invalidConfig(name);
  return value;
}

/** 读取严格布尔值。
 * @param raw 原始值。
 * @param field 字段名。
 * @param fallback 默认值。
 * @returns 布尔值。
 * @throws StartupError 非 true/false。
 */
export function booleanSetting(
  raw: string | undefined,
  field: string,
  fallback: boolean,
): boolean {
  if (raw === undefined) return fallback;
  if (raw !== 'true' && raw !== 'false') return invalidConfig(field);
  return raw === 'true';
}

/** 校验绝对路径。
 * @param value 路径。
 * @param field 字段名。
 * @returns 原路径。
 * @throws StartupError 路径非法。
 */
export function absolutePath(value: string, field: string): string {
  if (!isAbsolute(value) || value.includes('\0')) return invalidConfig(field);
  return value;
}

/** 校验监听 IP 或 DNS 主机名。
 * @param host 监听地址。
 * @returns 有效地址。
 * @throws StartupError 地址非法。
 */
export function listenHost(host: string): string {
  if (isIP(host)) return host;
  if (host.length > 253 || !host.split('.').every(validHostLabel))
    return invalidConfig('HOST');
  return host;
}

/** 判断一个 DNS 标签是否合法。
 * @param label 标签。
 * @returns 是否合法。
 * @throws 不适用。
 */
function validHostLabel(label: string): boolean {
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label);
}

/** 校验密码字符数和 UTF-8 字节上限。
 * @param password 待验证密码。
 * @returns 是否满足公共密码约束。
 * @throws 不适用。
 */
export function validPassword(password: string): boolean {
  const length = [...password].length;
  return (
    length >= 12 && length <= 128 && Buffer.byteLength(password, 'utf8') <= 512
  );
}

/** 严格解码标准 base64，避免 Buffer 的宽松解析。
 * @param value 原始字符串。
 * @param bytes 预期字节数；省略表示不限定长度。
 * @returns 解码后的二进制。
 * @throws Error 编码或长度非法；消息不包含输入。
 */
export function decodeBase64(value: string, bytes?: number): Buffer {
  const result = Buffer.from(value, 'base64');
  if (
    result.toString('base64') !== value ||
    (bytes !== undefined && result.length !== bytes)
  ) {
    throw new Error('Invalid base64 encoding');
  }
  return result;
}
