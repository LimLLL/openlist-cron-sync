// 运行详情头部下方的事实：停止原因横幅，以及“已完成/计划”计数、字节、失败与问题数；不显示总百分比或剩余时间。
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FactStrip } from '../../components/page';
import type { Fact } from '../../components/page';
import { useErrorText } from '../../i18n/error-text';
import { formatBytes } from '../../lib/format';
import { cn } from '../../lib/utils';
import { RunDuration } from './run-cells';
import { formatCount, runCounts } from './run-format';
import type { RunDetail } from './run-contract';

/** 渲染“已完成 / 计划”形式的计数。
 * @param props done 已完成；planned 计划量（已格式化）。
 * @returns 计数文本。
 * @throws 不适用。
 */
function OfPlanned({ done, planned }: { done: string; planned: string }) {
  const { t } = useTranslation('runs');
  return (
    <span>
      {done}
      <span className="ml-1 text-xs font-normal text-muted-foreground">
        {t('detail.facts.plannedOf', { value: planned })}
      </span>
    </span>
  );
}

/** 渲染需要关注时着色的计数。
 * @param props value 计数；tone 大于 0 时的颜色。
 * @returns 计数文本。
 * @throws 不适用。
 */
function Flagged({
  value,
  tone,
}: {
  value: number;
  tone: 'danger' | 'warning';
}): ReactNode {
  return (
    <span
      className={cn(
        value > 0 && (tone === 'danger' ? 'text-danger' : 'text-warning'),
      )}
    >
      {formatCount(value)}
    </span>
  );
}

/** 渲染运行级错误横幅：本地化说明 + 原始错误码与消息。
 * @param props run 运行详情。
 * @returns 横幅；没有错误时为 null。
 * @throws 不适用。
 */
export function RunErrorBanner({ run }: { run: RunDetail }) {
  const { t } = useTranslation('runs');
  const errorText = useErrorText();
  if (!run.error) return null;
  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-danger/25 bg-danger/6 p-3 text-[13px]"
    >
      <p className="font-medium text-danger">{t('detail.errorTitle')}</p>
      <p className="mt-1">{errorText(run.error.code, run.error.message)}</p>
      <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
        {run.error.code} · {run.error.message}
      </p>
    </div>
  );
}

/** 渲染运行的关键计数条：正式运行看已完成量对比计划量，试运行只看计划量。
 * @param props run 运行详情。
 * @returns 信息条。
 * @throws 不适用。
 */
export function RunFacts({ run }: { run: RunDetail }) {
  const { t } = useTranslation('runs');
  const counts = runCounts(run.stats);
  const facts: Fact[] = run.dryRun
    ? [
        {
          label: t('detail.facts.plannedCreates'),
          value: formatCount(counts.plannedCreates),
        },
        {
          label: t('detail.facts.plannedReplacements'),
          value: formatCount(counts.plannedReplacements),
        },
        {
          label: t('detail.facts.plannedDeletes'),
          value: formatCount(counts.plannedDeletes),
        },
        {
          label: t('detail.facts.plannedBytes'),
          value: formatBytes(counts.plannedBytes),
        },
      ]
    : [
        {
          label: t('detail.facts.created'),
          value: (
            <OfPlanned
              done={formatCount(counts.created)}
              planned={formatCount(counts.plannedCreates)}
            />
          ),
        },
        {
          label: t('detail.facts.replaced'),
          value: (
            <OfPlanned
              done={formatCount(counts.replaced)}
              planned={formatCount(counts.plannedReplacements)}
            />
          ),
        },
        {
          label: t('detail.facts.deleted'),
          value: (
            <OfPlanned
              done={formatCount(counts.deleted)}
              planned={formatCount(counts.plannedDeletes)}
            />
          ),
        },
        {
          label: (
            <span title={t('detail.facts.transferredHint')}>
              {t('detail.facts.transferred')}
            </span>
          ),
          value: (
            <OfPlanned
              done={formatBytes(counts.transferred)}
              planned={formatBytes(counts.plannedBytes)}
            />
          ),
        },
        {
          label: t('detail.facts.failed'),
          value: <Flagged value={counts.failed} tone="danger" />,
        },
        {
          label: t('detail.facts.unknown'),
          value: <Flagged value={counts.unknown} tone="danger" />,
        },
      ];
  facts.push(
    {
      label: t('detail.facts.issues'),
      value: <Flagged value={run.issueCount} tone="warning" />,
    },
    { label: t('detail.facts.duration'), value: <RunDuration run={run} /> },
  );
  return <FactStrip facts={facts} />;
}
