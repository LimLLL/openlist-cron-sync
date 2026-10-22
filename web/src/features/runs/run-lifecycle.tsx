// 生命周期分节：左侧时间线（接受、扫描、计划、取消、结束），右侧本次运行的关键设置。
import { useTranslation } from 'react-i18next';
import { Timeline } from '../../components/ui/timeline';
import type { TimelineItem } from '../../components/ui/timeline';
import { SpecGrid } from '../../components/ui/spec-grid';
import type { StatusTone } from '../../components/ui/status-dot';
import { ScrambleText } from '../../components/motion/scramble-text';
import { formatTimeFull } from '../../lib/format';
import type { RunDetail, RunStatus } from './run-contract';

const STOP_REASONS = ['USER_CANCEL', 'RUN_TIMEOUT', 'PROCESS_RESTART'] as const;

/** 判断停止原因是否有翻译。
 * @param value 后端停止原因。
 * @returns 是否为已知停止原因。
 * @throws 不适用。
 */
function isStopReason(value: string): value is (typeof STOP_REASONS)[number] {
  return (STOP_REASONS as readonly string[]).includes(value);
}

/** 终态对应的时间线节点色调。
 * @param status 运行状态。
 * @returns 状态点色调。
 * @throws 不适用。
 */
function endTone(status: RunStatus): StatusTone {
  if (status === 'succeeded') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'partial') return 'warning';
  return 'muted';
}

/** 渲染生命周期时间线与运行设置。
 * @param props detail 运行详情。
 * @returns 两栏布局。
 * @throws 不适用。
 */
export function RunLifecycle({ detail }: { detail: RunDetail }) {
  const { t } = useTranslation(['runs', 'common']);
  const stopReason = detail.stopReason
    ? isStopReason(detail.stopReason)
      ? t(`common:stopReason.${detail.stopReason}`)
      : detail.stopReason
    : null;
  const time = (iso: string | null) => (iso ? formatTimeFull(iso) : null);
  const items: TimelineItem[] = [
    { label: t('detail.timeline.created'), time: time(detail.createdAt) },
    { label: t('detail.timeline.started'), time: time(detail.startedAt) },
    {
      label: t('detail.timeline.scanCompleted'),
      time: time(detail.scanCompletedAt),
    },
    ...(detail.cancelRequestedAt
      ? [
          {
            label: t('detail.timeline.cancelRequested'),
            time: time(detail.cancelRequestedAt),
            tone: 'warning' as const,
          },
        ]
      : []),
    {
      label: t('detail.timeline.ended'),
      time: time(detail.endedAt),
      tone: detail.endedAt ? endTone(detail.status) : undefined,
      note: detail.endedAt ? t(`common:runStatus.${detail.status}`) : undefined,
    },
  ];

  return (
    <div className="grid items-start gap-10 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Timeline items={items} />
      <SpecGrid
        columns={2}
        items={[
          {
            label: t('detail.facts.id'),
            value: (
              <ScrambleText
                text={detail.id}
                className="text-[12.5px]"
                playOnMount
              />
            ),
            wide: true,
          },
          {
            label: t('detail.facts.trigger'),
            value: t(`detail.trigger.${detail.trigger}`),
          },
          {
            label: t('detail.facts.scheduledAt'),
            value: detail.scheduledAt
              ? formatTimeFull(detail.scheduledAt)
              : '—',
            mono: true,
          },
          {
            label: t('detail.facts.deleteThresholds'),
            value: detail.confirmDeletes
              ? t('detail.facts.thresholdsOverridden')
              : t('detail.facts.thresholdsEnforced'),
          },
          { label: t('detail.facts.stopReason'), value: stopReason ?? '—' },
          {
            label: t('detail.facts.deadline'),
            value: detail.deadlineAt ? formatTimeFull(detail.deadlineAt) : '—',
            mono: true,
            wide: true,
          },
        ]}
      />
    </div>
  );
}
