// 运行档案头部：状态与耗时、取消提示、停止原因，以及发丝线分隔的四项大数字。
import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import { StatusDot } from '../../components/ui/status-dot';
import { CountUp } from '../../components/motion/count-up';
import { formatBytes, formatDuration, formatRelative, formatTimeFull } from '../../lib/format';
import { useErrorText } from '../../i18n/error-text';
import { ACTIVE_RUN_STATUSES } from './run-contract';
import type { RunDetail } from './run-contract';
import { statusBadgeProps } from './run-status';
import { runDurationSeconds } from './run-format';
import { AnimatedValue } from './animated-value';
import { cn } from '../../lib/utils';

/** 大数字项。 */
interface Figure {
  /** 标签文案。 */
  label: string;
  /** 数值。 */
  value: number;
  /** 是否按字节格式化。 */
  bytes?: boolean;
  /** 非零时以信号色强调。 */
  alert?: boolean;
}

/** 汇总若干统计字段。
 * @param stats 运行统计。
 * @param keys 字段名。
 * @returns 合计值，缺失字段按 0 计。
 * @throws 不适用。
 */
function sum(stats: Record<string, number>, keys: string[]): number {
  return keys.reduce((total, key) => total + (stats[key] ?? 0), 0);
}

/** 渲染运行档案头部。
 * @param props detail 运行详情。
 * @returns 状态行、提示与统计条。
 * @throws 不适用。
 */
export function RunDossier({ detail }: { detail: RunDetail }) {
  const { t } = useTranslation(['runs', 'common']);
  const errorText = useErrorText();
  const badge = statusBadgeProps(detail.status);
  const active = ACTIVE_RUN_STATUSES.has(detail.status);
  const duration = runDurationSeconds(detail);
  const { stats } = detail;
  // 预览运行展示计划值，真实运行展示已执行的值。
  const figures: Figure[] = detail.dryRun
    ? [
        { label: t('detail.figures.plannedCopies'), value: sum(stats, ['plannedCreates']) },
        {
          label: t('detail.figures.plannedDeletes'),
          value: sum(stats, ['plannedExtraDeletes', 'plannedDirectoryDeletes', 'plannedReplacements']),
        },
        { label: t('detail.figures.plannedBytes'), value: sum(stats, ['plannedBytes']), bytes: true },
        { label: t('detail.figures.issues'), value: detail.issueCount, alert: true },
      ]
    : [
        { label: t('detail.figures.copied'), value: sum(stats, ['succeededCreates']) },
        { label: t('detail.figures.deleted'), value: sum(stats, ['deletedAsExtra', 'deletedForReplace']) },
        { label: t('detail.figures.transferred'), value: sum(stats, ['transferredBytes']), bytes: true },
        { label: t('detail.figures.issues'), value: detail.issueCount, alert: true },
      ];
  const message = detail.error ? errorText(detail.error.code, detail.error.message) : null;

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Badge variant={badge.variant} pulse={badge.pulse} className="px-3 py-1.5 text-xs">
          {t(`common:runStatus.${detail.status}`)}
        </Badge>
        {detail.dryRun && (
          <span title={t('detail.dryRunHint')}>
            <Badge variant="info" plain>
              <Eye size={12} aria-hidden="true" />
              {t('common:dryRun')}
            </Badge>
          </span>
        )}
        <span className="font-mono text-xs text-muted-foreground">
          {duration === null
            ? t('detail.queued')
            : active
              ? t('detail.running', { value: formatDuration(duration) })
              : t('detail.duration', { value: formatDuration(duration) })}
        </span>
        {detail.endedAt && (
          <span className="font-mono text-xs text-muted-foreground">
            {t('detail.endedAgo', { time: formatRelative(detail.endedAt) })}
          </span>
        )}
      </div>

      {detail.cancelRequestedAt && (
        <p className="mt-5 flex items-center gap-2.5 text-sm text-signal">
          <StatusDot tone="warning" pulse={active} />
          {t('detail.cancelRequested', { time: formatTimeFull(detail.cancelRequestedAt) })}
        </p>
      )}

      {detail.error && (
        <div className="mt-6 max-w-3xl rounded-2xl border border-danger/25 bg-danger/[0.05] p-5">
          <p className="eyebrow text-danger">{t('detail.errorTitle')}</p>
          <p className="mt-2 text-[15px] leading-7">{message}</p>
          <p className="mt-2 font-mono text-[11.5px] break-all text-muted-foreground">
            {detail.error.code}
            {/* 后端无消息时以错误码兜底，此时原文与错误码重复，不再显示。 */}
            {message !== detail.error.message &&
              detail.error.message !== detail.error.code &&
              ` · ${detail.error.message}`}
          </p>
        </div>
      )}

      <dl className="mt-10 grid grid-cols-2 border-y border-hairline lg:grid-cols-4">
        {figures.map((figure, position) => (
          <div
            key={figure.label}
            className={cn(
              'py-7 pr-4',
              position % 2 === 1 && 'border-l border-hairline pl-6',
              position >= 2 && 'border-t border-hairline lg:border-t-0',
              position === 2 && 'pl-0 lg:border-l lg:pl-6',
            )}
          >
            <dt className="eyebrow">{figure.label}</dt>
            <dd
              className={cn(
                'stat-figure mt-4',
                figure.alert && figure.value > 0 && 'text-signal',
              )}
            >
              {figure.bytes ? (
                <AnimatedValue value={figure.value} format={formatBytes} />
              ) : (
                <CountUp value={figure.value} />
              )}
            </dd>
          </div>
        ))}
      </dl>
      {detail.dryRun && (
        <p className="mt-4 text-xs text-muted-foreground">{t('detail.dryRunNote')}</p>
      )}
    </div>
  );
}
