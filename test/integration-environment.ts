// 在集成测试收集前验证所有必需变量，错误只列变量名。
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/** 本地开发时从项目根 .env 补充 OPENLIST_IT_* 变量；其他变量一律忽略，已设置的环境变量优先。
 * @param file .env 文件位置；不存在时不做任何事。
 * @param environment 要补充的环境，默认当前进程。
 * @returns 不适用。
 * @throws Error 文件存在但无法读取。
 */
export function loadLocalIntegrationVariables(
  file: URL,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (!existsSync(file)) return;
  const values = parseEnv(readFileSync(file, 'utf8'));
  for (const [name, value] of Object.entries(values))
    if (name.startsWith('OPENLIST_IT_') && value !== undefined)
      environment[name] ??= value;
}
/** 真实 OpenList 测试配置，不写日志。 */
export interface IntegrationEnvironment {
  /** 实例地址，允许反代子路径。 */
  baseUrl: string;
  /** 管理员静态 token。 */
  adminToken: string;
  /** 可读取 Local 目录的用户名。 */
  username: string;
  /** 该账号原始密码。 */
  password: string;
  /** 两种账号均可见的账号相对 Local 目录。 */
  localPath: string;
}
export const INTEGRATION_VARIABLES = [
  'OPENLIST_IT_BASE_URL',
  'OPENLIST_IT_ADMIN_TOKEN',
  'OPENLIST_IT_USERNAME',
  'OPENLIST_IT_PASSWORD',
  'OPENLIST_IT_LOCAL_PATH',
] as const;
/** 集中读取所有必需变量，缺少任何一个立即失败。
 * @param environment 环境来源。
 * @returns 完整配置。
 * @throws Error 缺失或格式错误，仅包含字段名。
 */
export function integrationEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): IntegrationEnvironment {
  const missing = INTEGRATION_VARIABLES.filter(
    /** 检查缺失或空字符串。
     * @param name 字段名。
     * @returns 是否缺失。
     * @throws 不适用。
     */
    (name) => environment[name] === undefined || environment[name] === '',
  );
  if (missing.length)
    throw new Error(
      `Missing integration environment variables: ${missing.join(', ')}`,
    );
  const baseUrl = required(environment, 'OPENLIST_IT_BASE_URL');
  const localPath = required(environment, 'OPENLIST_IT_LOCAL_PATH');
  try {
    const url = new URL(baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      /[\s\\?#]/u.test(baseUrl)
    )
      throw new Error('Invalid URL');
  } catch {
    throw new Error('Invalid integration environment: OPENLIST_IT_BASE_URL');
  }
  if (
    !localPath.startsWith('/') ||
    localPath.startsWith('/@s') ||
    localPath.includes('\\') ||
    localPath.split('/').some(isDot)
  )
    throw new Error('Invalid integration environment: OPENLIST_IT_LOCAL_PATH');
  return {
    baseUrl,
    localPath,
    adminToken: required(environment, 'OPENLIST_IT_ADMIN_TOKEN'),
    username: required(environment, 'OPENLIST_IT_USERNAME'),
    password: required(environment, 'OPENLIST_IT_PASSWORD'),
  };
}
/** 读取经集中验证的值。
 * @param environment 环境。
 * @param name 变量名。
 * @returns 非空字符串。
 * @throws Error 缺少字段。
 */
function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value)
    throw new Error(`Missing integration environment variable: ${name}`);
  return value;
}
/** 检查逃逸路径段。
 * @param segment 路径段。
 * @returns 是否为点段。
 * @throws 不适用。
 */
function isDot(segment: string): boolean {
  return segment === '.' || segment === '..';
}
