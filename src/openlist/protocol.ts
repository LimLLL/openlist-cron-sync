// 验证文件列表、公开设置及账号能力的协议事实。
import {
  boolean,
  integer,
  object,
  OpenListError,
  protocol,
  string,
} from './errors.js';
import { validName } from './paths.js';
import type { Account } from './auth.service.js';

/** 安全诊断；不包含上游正文或秘密。 */
export interface Warning {
  /** 登记的固定原因码。 */
  code: string;
  /** 服务生成的摘要。 */
  message: string;
}
/** 可供内部读取使用的合法文件条目。 */
export interface FileEntry {
  /** 原始名称，不做 trim 或解码。 */
  name: string;
  /** 字节数；负数映射 null，拒绝不安全整数。 */
  size: number | null;
  /** 是否目录。 */
  isDir: boolean;
  /** 上游修改时间；空值映射 null。 */
  modified: string | null;
  /** 短期下载签名，不持久化、不返回浏览 API。 */
  sign: string;
  /** 是否携带挂载提示，不保留提示内容。 */
  mountDetails: boolean;
}
/** 完整列表读取结果。 */
export interface FileList {
  /** 合法条目；非法名称已移除。 */
  items: FileEntry[];
  /** 上游报告总数。 */
  total: number;
  /** 当前目录写入提示。 */
  write: boolean;
  /** 不可用条目的安全诊断。 */
  warnings: Warning[];
}
/** 已支持版本的分片上传能力。 */
export interface MultipartSettings {
  /** 是否启用分片上传。 */
  enabled: boolean;
  /** 上游配置的分片大小，MiB，只展示。 */
  chunkSizeMiB: number;
}
/** 公开版本与上传能力。 */
export interface PublicSettings {
  /** 上游完整版本描述。 */
  version: string;
  /** 版本不低于 4.2.5 时的分片能力；版本不受支持时为 null，旧版本可能根本没有这些字段。 */
  multipart: MultipartSettings | null;
}
/** 验证单个文件对象，不容忍数值精度丢失。
 * @param input 上游 JSON。
 * @returns 合法文件事实。
 * @throws OpenListError 非法名称、大小或协议结构。
 */
export function fileEntry(input: unknown): FileEntry {
  const data = object(input);
  const name = string(data.name);
  if (!validName(name))
    throw new OpenListError(
      'INVALID_NAME',
      'OpenList entry has an unusable name',
    );
  const size = data.size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size))
    throw new OpenListError(
      'INVALID_SIZE',
      'OpenList file size is not a safe integer',
    );
  const modified = string(data.modified);
  return {
    name,
    size: size < 0 ? null : size,
    isDir: boolean(data.is_dir),
    modified: modified || null,
    sign: string(data.sign),
    mountDetails:
      data.mount_details !== undefined && data.mount_details !== null,
  };
}
/** 解析完整目录，仅 code200 的 content:null 视为空。
 * @param input 成功 envelope 的 data。
 * @param path 已规范化账号路径。
 * @returns 合法条目及警告。
 * @throws OpenListError 协议或大小异常。
 */
export function fileList(input: unknown, path: string): FileList {
  const data = object(input);
  const content: unknown = data.content === null ? [] : data.content;
  if (!Array.isArray(content)) protocol('list content');
  const total = integer(data.total);
  if (total !== content.length) protocol('list total');
  const result: FileList = {
    items: [],
    total,
    write: boolean(data.write),
    warnings: [],
  };
  for (const entry of content) {
    try {
      const parsed = fileEntry(entry);
      if (path === '/' && parsed.name.startsWith('@s')) {
        result.warnings.push({
          code: 'INVALID_NAME',
          message: 'Share namespace entry excluded',
        });
        continue;
      }
      result.items.push(parsed);
    } catch (error) {
      if (!(error instanceof OpenListError) || error.code !== 'INVALID_NAME')
        throw error;
      result.warnings.push({ code: error.code, message: error.message });
    }
  }
  return result;
}
/** 解析 OpenList 字符串设置，先判版本再要求分片字段，拒绝隐式真假转换。
 * @param input 上游设置对象。
 * @returns 版本与分片能力；版本不受支持时分片能力为 null。
 * @throws OpenListError 必要字段缺失或类型错误。
 */
export function publicSettings(input: unknown): PublicSettings {
  const data = object(input);
  const version = string(data.version);
  if (!supportedVersion(version)) return { version, multipart: null };
  if (data.multipart_enabled !== 'true' && data.multipart_enabled !== 'false')
    protocol('multipart_enabled');
  const chunk = string(data.multipart_chunk_size);
  if (
    !/^\d+$/.test(chunk) ||
    !Number.isSafeInteger(Number(chunk)) ||
    Number(chunk) <= 0
  )
    protocol('multipart_chunk_size');
  return {
    version,
    multipart: {
      enabled: data.multipart_enabled === 'true',
      chunkSizeMiB: Number(chunk),
    },
  };
}
/** 检查最低稳定版本，不猜测无法解析的描述。
 * @param version 上游版本字符串。
 * @returns 是否可解析且不低于 4.2.5；预发行版本不受支持。
 * @throws 不适用。
 */
export function supportedVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?=$|\s|\+)/.exec(version);
  const parts = match?.slice(1).map(Number);
  return !(
    !parts ||
    parts.some(notSafe) ||
    parts[0] < 4 ||
    (parts[0] === 4 && (parts[1] < 2 || (parts[1] === 2 && parts[2] < 5)))
  );
}
/** 检查版本段整数。
 * @param value 数字。
 * @returns 是否不安全。
 * @throws 不适用。
 */
function notSafe(value: number): boolean {
  return !Number.isSafeInteger(value);
}
/** 给出账号能力提示，不以探测写入推断权限。
 * @param account 已验证账号。
 * @returns 安全警告。
 * @throws 不适用。
 */
export function accountWarnings(account: Account): Warning[] {
  const warnings: Warning[] = [];
  if (account.role !== 2)
    warnings.push({
      code: 'MOUNT_BOUNDARY_UNKNOWN',
      message: 'Non-admin account cannot verify the complete mount map',
    });
  // 上游 CanSeeHides 只看权限位 0，管理员缺少该位同样看不到隐藏条目。
  if ((account.permissions & 1) === 0)
    warnings.push({
      code: 'SUSPECT_VIEW',
      message: 'Account cannot see hidden entries; listings may be incomplete',
    });
  return warnings;
}
