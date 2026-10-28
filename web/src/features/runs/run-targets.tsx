// 运行详情的“目标”标签：每个目标一张紧凑卡片，显示快照中的路径/模式/创建方式、扫描完整性、删除预算与阻止原因及本目标计数。
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PathText } from '../../components/text';
import { Badge } from '../../components/ui/badge';
import { useErrorText } from '../../i18n/error-text';
import { formatBytes } from '../../lib/format';
import { formatCount, runCounts, targetLabel } from './run-format';
import type { RunTargetView } from './run-contract';

/** 渲染一个指标：小号标签在上、值在下。
 * @param props label 标签；children 值。
 * @returns 指标元素。
 * @throws 不适用。
 */
function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] tabular-nums">{children}</dd>
    </div>
  );
}

/** 渲染扫描完整性：完整为普通文字，不完整用警示色。
 * @param props complete 是否完整。
 * @returns 文字。
 * @throws 不适用。
 */
function Coverage({ complete }: { complete: boolean }) {
  const { t } = useTranslation('runs');
  return complete ? (
    <span>{t('detail.targets.complete')}</span>
  ) : (
    <span className="text-warning">{t('detail.targets.incomplete')}</span>
  );
}

/** 渲染运行的全部目标；内容全部来自运行快照，不受当前任务配置影响。
 * @param props targets 运行目标列表。
 * @returns 目标卡片列表。
 * @throws 不适用。
 */
export function RunTargets({ targets }: { targets: RunTargetView[] }) {
  const { t } = useTranslation(['runs', 'common']);
  const errorText = useErrorText();
  return (
    <ol className="space-y-3">
      {targets.map((target, index) => {
        const label = targetLabel(target);
        const blocked = target.deleteBlocked || target.extrasBlocked;
        const counts = runCounts(target.stats);
        return (
          <li
            key={target.id}
            className="rounded-lg border border-border bg-surface"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2.5">
              <span className="text-xs text-muted-foreground tabular-nums">
                {t('detail.targets.position', { index: index + 1 })}
              </span>
              <span className="text-[13px] font-medium">
                {target.instanceName}
              </span>
              <PathText
                path={label.path ?? '—'}
                className="max-w-96 text-muted-foreground"
              />
              <span className="flex flex-wrap gap-1.5">
                {label.mode && (
                  <Badge tone={label.mode === 'mirror' ? 'warning' : 'neutral'}>
                    {t(`common:targetMode.${label.mode}`)}
                  </Badge>
                )}
                <Badge>{t(`common:operationMethod.${label.createMode}`)}</Badge>
                {target.suspect && (
                  <Badge tone="warning">{t('detail.targets.suspect')}</Badge>
                )}
                {blocked && (
                  <Badge tone="danger">{t('detail.targets.blocked')}</Badge>
                )}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-4 lg:grid-cols-8">
              <Metric label={t('detail.targets.sourceScan')}>
                <Coverage complete={target.sourceComplete} />
              </Metric>
              <Metric label={t('detail.targets.targetScan')}>
                <Coverage complete={target.targetComplete} />
              </Metric>
              <Metric label={t('detail.targets.plannedReplace')}>
                {formatCount(target.plannedReplaceCount)}
              </Metric>
              <Metric label={t('detail.targets.plannedExtra')}>
                {formatCount(target.plannedExtraCount)}
              </Metric>
              <Metric label={t('detail.targets.budget')}>
                {target.deleteBudgetCount === null ? (
                  <span className="text-muted-foreground">
                    {t('detail.targets.budgetUnlimited')}
                  </span>
                ) : (
                  formatCount(target.deleteBudgetCount)
                )}
              </Metric>
              <Metric label={t('detail.targets.observed')}>
                {formatCount(target.observedTargetFileCount)}
              </Metric>
              <Metric label={t('detail.targets.created')}>
                {formatCount(counts.created)}
                <span className="ml-1 text-xs text-muted-foreground">
                  {t('detail.targets.deleted')} {formatCount(counts.deleted)}
                </span>
              </Metric>
              <Metric label={t('detail.targets.transferred')}>
                {formatBytes(counts.transferred)}
              </Metric>
            </dl>
            {blocked && target.blockReasons.length > 0 && (
              <div className="border-t border-border px-4 py-2.5">
                <p className="text-xs font-medium text-danger">
                  {t('detail.targets.reasons')}
                </p>
                <ul className="mt-1 space-y-0.5 text-[13px]">
                  {target.blockReasons.map((reason) => (
                    <li key={reason}>
                      {errorText(reason, reason)}
                      <span
                        translate="no"
                        className="ml-2 font-mono text-[11px] text-muted-foreground"
                      >
                        {reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
