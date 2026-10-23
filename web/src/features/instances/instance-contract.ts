// 定义实例响应类型与运行时校验，保持前端与后端 API 契约一致。
import { ApiError, isRecord } from '../../lib/api-client';
import type { Page } from '../../lib/parsers';
import {
  parsePage,
  expectString,
  expectNumber,
  expectBoolean,
  expectEnum,
  parseDiagnostic,
} from '../../lib/parsers';

/** 诊断信息（错误或警告）。 */
export interface Diagnostic {
  /** 固定原因码。 */
  code: string;
  /** 无秘密摘要。 */
  message: string;
}

/** 认证公开视图。 */
export interface AuthView {
  /** 认证方式。 */
  mode: 'token' | 'password';
  /** password 模式用户名；token 时 null。 */
  username: string | null;
  /** 是否已保存凭据。 */
  hasSecret: boolean;
}

/** 实例管理 API 配额；传输并发属于任务与目标。 */
export interface InstanceLimits {
  /** API 并发数。 */
  maxApiConcurrency: number;
  /** 每秒 API 请求数。 */
  apiRequestsPerSecond: number;
}

/** 实例公共视图。 */
export interface Instance {
  /** UUIDv4。 */
  id: string;
  /** 展示名称。 */
  name: string;
  /** 规范化地址。 */
  baseUrl: string;
  /** 认证公开视图。 */
  auth: AuthView;
  /** 全部有效配额。 */
  limits: InstanceLimits;
  /** 下载模式。 */
  downloadMode: 'd' | 'p';
  /** 认证状态。 */
  authState: 'untested' | 'ready' | 'auth_blocked';
  /** 认证阻断原因。 */
  authBlockReason: string | null;
  /** 已确认账号用户名。 */
  accountUsername: string | null;
  /** 已确认账号根路径。 */
  accountBasePath: string | null;
  /** OpenList 版本。 */
  openlistVersion: string | null;
  /** 认证阻断截止时间。 */
  authBlockedUntil: string | null;
  /** 最近测试时间。 */
  lastTestAt: string | null;
  /** 归档时间。 */
  archivedAt: string | null;
  /** 上游角色。 */
  accountRole: number | null;
  /** 上游权限位图。 */
  accountPermissions: number | null;
  /** 是否支持分片上传。 */
  multipartEnabled: boolean | null;
  /** 最近错误。 */
  lastError: Diagnostic | null;
  /** 创建时间。 */
  createdAt: string;
  /** 更新时间。 */
  updatedAt: string;
}

/** 连接测试中确认的账号信息。 */
export interface TestAccount {
  /** 账号名。 */
  username: string;
  /** 账号全局根路径。 */
  basePath: string;
  /** 角色（0 普通用户，2 管理员）。 */
  role: number;
  /** 权限位图。 */
  permissions: number;
}

/** 连接测试结果。 */
export interface TestResult {
  /** 是否收到上游响应。 */
  reachable: boolean;
  /** 是否确认非 guest 身份。 */
  authenticated: boolean;
  /** 已确认账号；失败时 null。 */
  account: TestAccount | null;
  /** 能力限制与挂载警告。 */
  warnings: Diagnostic[];
  /** 失败原因。 */
  error: Diagnostic | null;
}

/** 目录浏览条目。 */
export interface BrowseItem {
  /** 原始名称。 */
  name: string;
  /** 字节数。 */
  size: number | null;
  /** 是否目录。 */
  isDir: boolean;
  /** 修改时间。 */
  modified: string | null;
}

/** 目录浏览结果。 */
export interface BrowseResult {
  /** 规范化请求路径。 */
  path: string;
  /** 本页条目。 */
  items: BrowseItem[];
  /** 页号。 */
  page: number;
  /** 页大小。 */
  pageSize: number;
  /** 总数。 */
  total: number;
  /** 写权限提示。 */
  write: boolean;
  /** 警告。 */
  warnings: Diagnostic[];
}

/** 实例创建/更新请求体。 */
export interface InstanceInput {
  /** 展示名。 */
  name?: string;
  /** 地址。 */
  baseUrl?: string;
  /** 认证（整体替换）。 */
  auth?: { mode: 'token' | 'password'; username?: string; secret: string };
  /** 配额（按字段合并）。 */
  limits?: Partial<InstanceLimits>;
  /** 下载模式。 */
  downloadMode?: 'd' | 'p';
}

/** 解析诊断数组。
 * @param value 未信任的 JSON。
 * @returns 诊断数组。
 * @throws 不适用。
 */
function parseDiagnostics(value: unknown): Diagnostic[] {
  if (!Array.isArray(value))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid diagnostics.');
  return value.map(parseDiagnostic).filter((d): d is Diagnostic => d !== null);
}

/** 解析认证视图。
 * @param value 未信任的 JSON。
 * @returns 认证视图。
 * @throws ApiError 格式不合法。
 */
function parseAuth(value: unknown): AuthView {
  if (!isRecord(value))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid auth view.');
  return {
    mode: expectEnum(value.mode, ['password', 'token'], 'auth.mode'),
    username: typeof value.username === 'string' ? value.username : null,
    hasSecret: expectBoolean(value.hasSecret, 'hasSecret'),
  };
}

/** 解析实例配额。
 * @param value 未信任的 JSON。
 * @returns 配额对象。
 * @throws ApiError 格式不合法。
 */
function parseLimits(value: unknown): InstanceLimits {
  if (!isRecord(value))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid limits view.');
  return {
    maxApiConcurrency: expectNumber(
      value.maxApiConcurrency,
      'maxApiConcurrency',
    ),
    apiRequestsPerSecond: expectNumber(
      value.apiRequestsPerSecond,
      'apiRequestsPerSecond',
    ),
  };
}

/** 校验单个实例响应。
 * @param value 未信任的 JSON。
 * @returns 类型安全的实例对象。
 * @throws ApiError 响应不符合契约。
 */
export function parseInstance(value: unknown): Instance {
  if (!isRecord(value))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid instance.');
  return {
    id: expectString(value.id, 'id'),
    name: expectString(value.name, 'name'),
    baseUrl: expectString(value.baseUrl, 'baseUrl'),
    auth: parseAuth(value.auth),
    limits: parseLimits(value.limits),
    downloadMode: expectEnum(value.downloadMode, ['p', 'd'], 'downloadMode'),
    authState: expectEnum(
      value.authState,
      ['ready', 'auth_blocked', 'untested'],
      'authState',
    ),
    authBlockReason:
      typeof value.authBlockReason === 'string' ? value.authBlockReason : null,
    accountUsername:
      typeof value.accountUsername === 'string' ? value.accountUsername : null,
    accountBasePath:
      typeof value.accountBasePath === 'string' ? value.accountBasePath : null,
    openlistVersion:
      typeof value.openlistVersion === 'string' ? value.openlistVersion : null,
    authBlockedUntil:
      typeof value.authBlockedUntil === 'string'
        ? value.authBlockedUntil
        : null,
    lastTestAt: typeof value.lastTestAt === 'string' ? value.lastTestAt : null,
    archivedAt: typeof value.archivedAt === 'string' ? value.archivedAt : null,
    accountRole:
      typeof value.accountRole === 'number' ? value.accountRole : null,
    accountPermissions:
      typeof value.accountPermissions === 'number'
        ? value.accountPermissions
        : null,
    multipartEnabled:
      typeof value.multipartEnabled === 'boolean'
        ? value.multipartEnabled
        : null,
    lastError: parseDiagnostic(value.lastError),
    createdAt: expectString(value.createdAt, 'createdAt'),
    updatedAt: expectString(value.updatedAt, 'updatedAt'),
  };
}

/** 解析实例分页响应。
 * @param value 未信任的 JSON。
 * @returns 类型安全的分页实例列表。
 * @throws ApiError 响应不符合分页契约。
 */
export function parseInstancePage(value: unknown): Page<Instance> {
  return parsePage(value, parseInstance, 'instances');
}

/** 解析连接测试账号信息。
 * @param value 未信任的 JSON。
 * @returns 账号信息或 null。
 * @throws 不适用。
 */
function parseTestAccount(value: unknown): TestAccount | null {
  if (value === null || !isRecord(value)) return null;
  return {
    username: typeof value.username === 'string' ? value.username : '',
    basePath: typeof value.basePath === 'string' ? value.basePath : '',
    role: typeof value.role === 'number' ? value.role : 0,
    permissions: typeof value.permissions === 'number' ? value.permissions : 0,
  };
}

/** 校验连接测试响应。
 * @param value 未信任的 JSON。
 * @returns 类型安全的测试结果。
 * @throws ApiError 响应不符合契约。
 */
export function parseTestResult(value: unknown): TestResult {
  if (!isRecord(value))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid test result.');
  return {
    reachable: expectBoolean(value.reachable, 'reachable'),
    authenticated: expectBoolean(value.authenticated, 'authenticated'),
    account: parseTestAccount(value.account),
    warnings: parseDiagnostics(value.warnings),
    error: parseDiagnostic(value.error),
  };
}

/** 解析目录浏览条目。
 * @param value 未信任的 JSON。
 * @returns 浏览条目。
 * @throws ApiError 格式不合法。
 */
function parseBrowseItem(value: unknown): BrowseItem {
  if (!isRecord(value))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid browse item.');
  return {
    name: expectString(value.name, 'name'),
    size: typeof value.size === 'number' ? value.size : null,
    isDir: expectBoolean(value.isDir, 'isDir'),
    modified: typeof value.modified === 'string' ? value.modified : null,
  };
}

/** 校验目录浏览响应。
 * @param value 未信任的 JSON。
 * @returns 类型安全的浏览结果。
 * @throws ApiError 响应不符合契约。
 */
export function parseBrowseResult(value: unknown): BrowseResult {
  if (!isRecord(value) || !Array.isArray(value.items))
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid browse result.');
  return {
    path: expectString(value.path, 'path'),
    items: value.items.map(parseBrowseItem),
    page: expectNumber(value.page, 'page'),
    pageSize: expectNumber(value.pageSize, 'pageSize'),
    total: expectNumber(value.total, 'total'),
    write: expectBoolean(value.write, 'write'),
    warnings: parseDiagnostics(value.warnings),
  };
}
