// 实例状态的唯一判定与徽标，概览、实例列表与详情共用，避免同一实例在不同页面显示不同状态。
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import type { Instance } from './instance-contract';

/** 实例状态：可用、认证被封锁、最近一次测试或访问出错、尚未测试。 */
export type InstanceHealth = 'ready' | 'blocked' | 'error' | 'untested';

/** 判定实例状态：封锁优先，其次是最近错误，再看认证状态。
 * 这是后端记录的最近一次认证/测试结果，不代表此刻一定可达。
 * @param instance 实例。
 * @returns 状态。
 * @throws 不适用。
 */
export function instanceHealth(
  instance: Pick<Instance, 'authState' | 'lastError'>,
): InstanceHealth {
  if (instance.authState === 'auth_blocked') return 'blocked';
  if (instance.lastError) return 'error';
  return instance.authState === 'ready' ? 'ready' : 'untested';
}

/** 判断实例是否需要关注（封锁或出错）。
 * @param instance 实例。
 * @returns 是否需要关注。
 * @throws 不适用。
 */
export function instanceNeedsAttention(
  instance: Pick<Instance, 'authState' | 'lastError'>,
): boolean {
  const health = instanceHealth(instance);
  return health === 'blocked' || health === 'error';
}

const TONES = {
  ready: 'success',
  blocked: 'danger',
  error: 'warning',
  untested: 'neutral',
} as const;

/** 渲染实例状态徽标。
 * @param props instance 实例。
 * @returns 徽标。
 * @throws 不适用。
 */
export function InstanceHealthBadge({
  instance,
}: {
  instance: Pick<Instance, 'authState' | 'lastError'>;
}) {
  const { t } = useTranslation('common');
  const health = instanceHealth(instance);
  return (
    <Badge tone={TONES[health]} dot>
      {t(`instanceHealth.${health}`)}
    </Badge>
  );
}

/** 把 “v4.2.7 (Commit…)” 缩写为 “v4.2.7”。
 * @param version 完整版本字符串。
 * @returns 短版本；缺失为 null。
 * @throws 不适用。
 */
export function shortVersion(version: string | null): string | null {
  if (!version) return null;
  return /^v?\d+(\.\d+)*/.exec(version.trim())?.[0] ?? version;
}
