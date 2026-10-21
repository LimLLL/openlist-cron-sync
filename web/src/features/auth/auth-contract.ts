// 定义并校验认证公开响应，保持与后端字符和字节边界一致。
import { ApiError, isRecord } from '../../lib/api-client';

/** 登录成功时返回的短期会话。 */
export interface LoginResult {
  /** 管理 JWT，由认证上下文负责持久化及退出清理。 */
  accessToken: string;
  /** 固定 Bearer 类型。 */
  tokenType: 'Bearer';
  /** 有效期秒数，后端范围 300–86400。 */
  expiresIn: number;
  /** 是否必须先修改初始密码。 */
  mustChangePassword: boolean;
}

/** 已认证管理员的公开字段。 */
export interface Administrator {
  /** 单管理员固定 ID。 */
  id: 1;
  /** 后端确认的用户名。 */
  username: string;
  /** 当前是否必须修改密码。 */
  mustChangePassword: boolean;
}

/** 校验登录返回值，拒绝缺少 token 或有效期的响应。
 * @param value 未信任的登录 JSON。
 * @returns 仅含公开认证字段的结果。
 * @throws ApiError 登录响应不符合契约。
 */
export function parseLogin(value: unknown): LoginResult {
  if (
    !isRecord(value) ||
    typeof value.accessToken !== 'string' ||
    !value.accessToken ||
    value.tokenType !== 'Bearer' ||
    typeof value.expiresIn !== 'number' ||
    !Number.isInteger(value.expiresIn) ||
    value.expiresIn < 300 ||
    value.expiresIn > 86400 ||
    typeof value.mustChangePassword !== 'boolean'
  ) {
    throw new ApiError(
      0,
      'INVALID_RESPONSE',
      'The server returned an invalid session.',
    );
  }
  return {
    accessToken: value.accessToken,
    tokenType: 'Bearer',
    expiresIn: value.expiresIn,
    mustChangePassword: value.mustChangePassword,
  };
}

/** 校验当前管理员，不接受任意角色或未知身份。
 * @param value 未信任的 /auth/me JSON。
 * @returns 管理员公开信息。
 * @throws ApiError 管理员响应不符合契约。
 */
export function parseAdministrator(value: unknown): Administrator {
  if (
    !isRecord(value) ||
    value.id !== 1 ||
    typeof value.username !== 'string' ||
    !value.username ||
    typeof value.mustChangePassword !== 'boolean'
  ) {
    throw new ApiError(
      0,
      'INVALID_RESPONSE',
      'The server returned an invalid administrator.',
    );
  }
  return {
    id: 1,
    username: value.username,
    mustChangePassword: value.mustChangePassword,
  };
}

/** 按 Unicode 码点与 UTF-8 字节校验密码，不裁剪或规范化秘密。
 * @param password 用户原始密码。
 * @returns 不合法时返回 auth 命名空间 validation 下的文案键；合法时为 null。
 * @throws 不适用。
 */
export function passwordError(password: string): 'passwordLength' | null {
  const length = [...password].length;
  return length < 12 ||
    length > 128 ||
    new TextEncoder().encode(password).length > 512
    ? 'passwordLength'
    : null;
}
