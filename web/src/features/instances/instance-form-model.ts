// 校验实例编辑值并生成最小补丁，避免认证模式修改被静默忽略。
import type {
  Instance,
  InstanceInput,
  InstanceLimits,
} from './instance-contract';
import type en from '../../i18n/locales/en/instances';
import { LIMIT_FIELDS } from './instance-display';

/** instances 命名空间 validation 下的文案键。 */
export type InstanceValidationKey = keyof (typeof en)['validation'];

/** 本地校验错误；message 为文案键，由表单按当前语言翻译。 */
export class InstanceFormError extends Error {
  /** 创建带文案键与插值参数的校验错误。
   * @param key validation 文案键。
   * @param limit 配额非法时的字段。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    readonly key: InstanceValidationKey,
    readonly limit?: { field: keyof InstanceLimits },
  ) {
    super(key);
    this.name = 'InstanceFormError';
  }
}

/** 实例表单的原始输入值。 */
export interface InstanceFormValues {
  /** 展示名称。 */
  name: string;
  /** HTTP(S) 实例地址。 */
  baseUrl: string;
  /** 认证判别字段。 */
  authMode: 'token' | 'password';
  /** password 模式用户名。 */
  username: string;
  /** 新凭据；编辑时空字符串表示保留。 */
  secret: string;
  /** 下载方式。 */
  downloadMode: 'd' | 'p';
  /** 已填写的配额。 */
  limits: Partial<InstanceLimits>;
}

/** 校验本地约束并构建创建请求或最小更新补丁。
 * @param values 当前表单输入，不裁剪秘密。
 * @param existing 编辑前的公开配置；创建时省略。
 * @returns 后端可接收的请求体。
 * @throws InstanceFormError 输入错误或没有需要保存的修改。
 */
export function buildInstanceInput(
  values: InstanceFormValues,
  existing?: Instance,
): InstanceInput {
  if ([...values.name].length < 1 || [...values.name].length > 100)
    throw new InstanceFormError('name');
  let url: URL;
  try {
    url = new URL(values.baseUrl);
  } catch {
    throw new InstanceFormError('url');
  }
  // 与后端一样拒绝地址中的 userinfo、查询、片段及控制字符。
  if (
    !/^https?:\/\//i.test(values.baseUrl) ||
    // oxlint-disable-next-line no-control-regex -- 输入协议禁止控制字符。
    /[\u0000-\u0020\u007f\\]/u.test(values.baseUrl) ||
    !['http:', 'https:'].includes(url.protocol) ||
    values.baseUrl.split('/')[2]?.includes('@') ||
    values.baseUrl.includes('?') ||
    values.baseUrl.includes('#')
  )
    throw new InstanceFormError('urlParts');
  const authChanged =
    !existing ||
    values.authMode !== existing.auth.mode ||
    (values.authMode === 'password' &&
      values.username !== existing.auth.username);
  if (
    (authChanged && !values.secret) ||
    (values.authMode === 'password' && !values.username)
  )
    throw new InstanceFormError('authChange');
  if (
    values.secret &&
    (/^\*+$/.test(values.secret) ||
      (values.authMode === 'token' && /[^\x21-\x7e]/u.test(values.secret)))
  )
    throw new InstanceFormError('secretFormat');
  const body: InstanceInput = {};
  if (!existing || values.name !== existing.name) body.name = values.name;
  if (!existing || values.baseUrl !== existing.baseUrl)
    body.baseUrl = values.baseUrl;
  if (!existing || values.downloadMode !== existing.downloadMode)
    body.downloadMode = values.downloadMode;
  if (!existing || values.secret)
    body.auth = {
      mode: values.authMode,
      secret: values.secret,
      ...(values.authMode === 'password' ? { username: values.username } : {}),
    };
  const limits: Partial<InstanceLimits> = {};
  for (const { key, defaultValue } of LIMIT_FIELDS) {
    // 编辑时清空表示恢复默认值；新建时留空交给后端默认值。
    const value = values.limits[key] ?? (existing ? defaultValue : undefined);
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0)
      throw new InstanceFormError('limit', { field: key });
    if (!existing || value !== existing.limits[key]) limits[key] = value;
  }
  if (Object.keys(limits).length) body.limits = limits;
  if (!Object.keys(body).length) throw new InstanceFormError('noChanges');
  return body;
}
