// 验证账号路径与原始名称，集中管理上游路径编码。
import { toUSVString } from 'node:util';
import { ApiError } from '../common/errors.js';
import { OpenListError } from './errors.js';

/** 规范化实例地址，保留反向代理前缀。
 * @param input 用户地址。
 * @returns 不带尾部斜杠的 http(s) 地址。
 * @throws ApiError 地址非法。
 */
export function normalizeBaseUrl(input: string): string {
  try {
    // oxlint-disable-next-line no-control-regex -- 明确拒绝 URL 控制字符。
    if (/[\u0000-\u0020\u007f\\]/u.test(input) || !/^https?:\/\//i.test(input))
      throw new Error('Invalid URL');
    const url = new URL(input);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      input.split('/')[2]?.includes('@') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      input.includes('?') ||
      input.includes('#')
    )
      throw new Error('Invalid URL');
    return url.href.replace(/\/+$/, '');
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid instance baseUrl');
  }
}
/** 校验并规范化账号内路径，不解码百分号。
 * @param input 原始路径。
 * @returns 规范化绝对路径。
 * @throws ApiError 路径越界、分享前缀或长度非法。
 */
export function normalizePath(input: string): string {
  const path = normalizeGlobalPath(input);
  if (path.startsWith('/@s'))
    throw new ApiError(400, 'INVALID_PATH', 'Share namespace is not supported');
  return path;
}
/** 校验全局路径；分享前缀限制只适用于账号相对文件 API 输入。
 * @param input 全局路径。
 * @returns 规范化路径。
 * @throws ApiError 非法路径。
 */
export function normalizeGlobalPath(input: string): string {
  if (
    !input.startsWith('/') ||
    // oxlint-disable-next-line no-control-regex -- 拒绝上游清理会改变含义的控制字符。
    /[\u0000-\u001f\u007f-\u009f\\]/u.test(input) ||
    Buffer.byteLength(input) > 4096 ||
    toUSVString(input) !== input
  )
    throw new ApiError(400, 'INVALID_PATH', 'Invalid account path');
  const segments = input.split('/').filter(Boolean);
  if (segments.some(invalidSegment))
    throw new ApiError(400, 'INVALID_PATH', 'Invalid account path');
  return '/' + segments.join('/');
}
/** 检查路径段边界。
 * @param segment 单段原文。
 * @returns 是否非法。
 * @throws 不适用。
 */
function invalidSegment(segment: string): boolean {
  return (
    segment === '.' || segment === '..' || Buffer.byteLength(segment) > 1024
  );
}
/** 验证上游原始名称，禁止清洗后指向其他对象。
 * @param name 原始名称。
 * @returns 是否可安全使用。
 * @throws 不适用。
 */
export function validName(name: string): boolean {
  return (
    name.length > 0 &&
    toUSVString(name) === name &&
    // oxlint-disable-next-line no-control-regex -- 非法名称不能被上游解释为路径。
    !/[/\\\u0000-\u001f\u007f-\u009f]/u.test(name) &&
    !invalidSegment(name)
  );
}
/** 拼接单个已验证名称。
 * @param directory 账号目录。
 * @param name 原始名称。
 * @returns 子路径。
 * @throws OpenListError 非法名称；ApiError 非法目录。
 */
export function childPath(directory: string, name: string): string {
  if (!validName(name))
    throw new OpenListError('INVALID_NAME', 'Invalid OpenList entry name');
  return normalizePath(
    `${normalizePath(directory).replace(/\/$/, '')}/${name}`,
  );
}
/** 按路径段包含关系比较。
 * @param parent 父路径。
 * @param child 子路径。
 * @returns 是否包含或相同。
 * @throws 不适用。
 */
export function containsPath(parent: string, child: string): boolean {
  return parent === '/' || parent === child || child.startsWith(parent + '/');
}
/** 将账号路径连接到全局 base_path。
 * @param basePath 已确认账号根。
 * @param path 账号内路径。
 * @returns 全局路径。
 * @throws ApiError 非法路径。
 */
export function globalPath(basePath: string, path: string): string {
  return normalizeGlobalPath(
    `${normalizeGlobalPath(basePath).replace(/\/$/, '')}${normalizePath(path)}`,
  );
}
/** 生成下载 URL，名称与签名分别编码。
 * @param baseUrl 实例地址。
 * @param basePath 账号根。
 * @param directory 账号目录。
 * @param name 原始名称。
 * @param sign 下载签名。
 * @param mode d 或 p。
 * @returns URL；禁止记录到日志。
 * @throws ApiError 非法路径；OpenListError 非法名称。
 */
export function downloadUrl(
  baseUrl: string,
  basePath: string,
  directory: string,
  name: string,
  sign: string,
  mode: 'd' | 'p',
): string {
  const path = globalPath(basePath, childPath(directory, name));
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${normalizeBaseUrl(baseUrl)}/${mode}${encoded}?${new URLSearchParams({ sign })}`;
}
