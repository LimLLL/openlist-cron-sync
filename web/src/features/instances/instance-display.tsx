// 实例展示辅助：统一的状态判定与标签、版本号缩写、配额字段元数据，列表、详情与表单共用。
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import type { Instance, InstanceLimits } from './instance-contract';

/** 实例在界面上的综合状态：阻止优先，其次是最近错误，再看认证状态。 */
export type InstanceStatus = 'ready' | 'auth_blocked' | 'untested' | 'error';

/** 推导实例综合状态。
 * @param instance 实例。
 * @returns 综合状态。
 * @throws 不适用。
 */
export function instanceStatus(instance: Instance): InstanceStatus {
  if (instance.authState === 'auth_blocked') return 'auth_blocked';
  if (instance.lastError) return 'error';
  return instance.authState;
}

/** 渲染实例状态标签；文字始终可见，颜色不是唯一信息。
 * @param props instance 实例。
 * @returns 状态标签。
 * @throws 不适用。
 */
export function InstanceStatusBadge({ instance }: { instance: Instance }) {
  const { t } = useTranslation('instances');
  const status = instanceStatus(instance);
  if (status === 'ready')
    return <Badge variant="success">{t('authState.ready')}</Badge>;
  if (status === 'auth_blocked')
    return <Badge variant="danger">{t('authState.auth_blocked')}</Badge>;
  if (status === 'error')
    return <Badge variant="warning">{t('status.error')}</Badge>;
  return <Badge variant="default">{t('authState.untested')}</Badge>;
}

/** 从完整版本串中取出语义版本号，如 "v4.2.7 (Commit …)" → "v4.2.7"。
 * @param version 上游版本串或 null。
 * @returns 简短版本号；无法识别时返回原串，缺失时返回 null。
 * @throws 不适用。
 */
export function shortVersion(version: string | null): string | null {
  if (!version) return null;
  return /^v?\d+(\.\d+)*/.exec(version.trim())?.[0] ?? version;
}

/** 配额字段及其后端默认值，顺序即展示顺序；取值为 0（不限）或正整数，无上限。 */
export const LIMIT_FIELDS: ReadonlyArray<{
  key: keyof InstanceLimits;
  defaultValue: number;
}> = [
  { key: 'maxApiConcurrency', defaultValue: 4 },
  { key: 'apiRequestsPerSecond', defaultValue: 5 },
];
