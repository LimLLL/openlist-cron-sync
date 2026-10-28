// 运行与文件操作的状态徽标：全站统一的色调映射与文案（common 命名空间），进行中状态带脉冲圆点。
import { useTranslation } from 'react-i18next';
import type { OperationStatus } from '../features/operations/operation-contract';
import type { RunStatus } from '../features/runs/run-contract';
import { Badge } from './ui/badge';
import type { Tone } from './ui/badge';

/** 运行状态到色调与是否进行中的映射。
 * @param status 运行状态。
 * @param stopReason 停止原因；超时取消按需要处理显示。
 * @returns 色调与脉冲标记。
 * @throws 不适用。
 */
export function runTone(
  status: RunStatus,
  stopReason: string | null = null,
): { tone: Tone; pulse: boolean } {
  switch (status) {
    case 'succeeded':
      return { tone: 'success', pulse: false };
    case 'partial':
    case 'interrupted':
      return { tone: 'warning', pulse: false };
    case 'failed':
      return { tone: 'danger', pulse: false };
    case 'cancelled':
      return {
        tone: stopReason === 'RUN_TIMEOUT' ? 'warning' : 'neutral',
        pulse: false,
      };
    case 'cancelling':
    case 'recovering':
      return { tone: 'warning', pulse: true };
    case 'queued':
      return { tone: 'neutral', pulse: true };
    default:
      // scanning / planned / executing
      return { tone: 'info', pulse: true };
  }
}

/** 渲染运行状态徽标；超时取消显示为“已超时”。
 * @param props status 运行状态；stopReason 停止原因。
 * @returns 徽标。
 * @throws 不适用。
 */
export function RunStatusBadge({
  status,
  stopReason = null,
}: {
  status: RunStatus;
  stopReason?: string | null;
}) {
  const { t } = useTranslation('common');
  const { tone, pulse } = runTone(status, stopReason);
  const label =
    status === 'cancelled' && stopReason === 'RUN_TIMEOUT'
      ? t('runStatus.timedOut')
      : t(`runStatus.${status}`);
  return (
    <Badge tone={tone} dot pulse={pulse}>
      {label}
    </Badge>
  );
}

/** 文件操作状态到色调的映射。
 * @param status 操作状态。
 * @returns 色调与脉冲标记。
 * @throws 不适用。
 */
export function operationTone(status: OperationStatus): {
  tone: Tone;
  pulse: boolean;
} {
  switch (status) {
    case 'succeeded':
      return { tone: 'success', pulse: false };
    case 'failed':
    case 'unknown':
      return { tone: 'danger', pulse: false };
    case 'submitting':
    case 'submitted':
    case 'running':
      return { tone: 'info', pulse: true };
    default:
      // pending / skipped / cancelled
      return { tone: 'neutral', pulse: false };
  }
}

/** 渲染文件操作状态徽标。
 * @param props status 操作状态。
 * @returns 徽标。
 * @throws 不适用。
 */
export function OperationStatusBadge({ status }: { status: OperationStatus }) {
  const { t } = useTranslation('common');
  const { tone, pulse } = operationTone(status);
  return (
    <Badge tone={tone} dot pulse={pulse}>
      {t(`operationStatus.${status}`)}
    </Badge>
  );
}
