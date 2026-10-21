// 目标汇总：每个目标一行，展示扫描覆盖、计划替换与多余、目标现有文件数与删除预算；被阻断时列出原因。
import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import { StatusDot } from '../../components/ui/status-dot';
import { useErrorText } from '../../i18n/error-text';
import { intlLocale } from '../../i18n';
import type { RunTargetView } from './run-contract';
import { targetLabel } from './run-format';

/** 按界面语言格式化整数。
 * @param value 数值。
 * @returns 带分隔符的字符串。
 * @throws 不适用。
 */
function count(value: number): string {
  return new Intl.NumberFormat(intlLocale()).format(value);
}

/** 渲染小标签与值。
 * @param props label 标签；children 值。
 * @returns 指标块。
 * @throws 不适用。
 */
function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <div className="mt-2 font-mono text-[13px]">{children}</div>
    </div>
  );
}

/** 渲染单端扫描覆盖状态。
 * @param props label 端名称；complete 是否完整扫描。
 * @returns 状态行。
 * @throws 不适用。
 */
function Coverage({ label, complete }: { label: string; complete: boolean }) {
  const { t } = useTranslation('runs');
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <StatusDot tone={complete ? 'success' : 'warning'} />
      <span>{label}</span>
      <span className={complete ? 'text-foreground' : 'text-signal'}>
        {complete ? t('detail.targets.complete') : t('detail.targets.incomplete')}
      </span>
    </p>
  );
}

/** 渲染目标汇总列表。
 * @param props targets 运行目标。
 * @returns 列表元素。
 * @throws 不适用。
 */
export function RunTargets({ targets }: { targets: RunTargetView[] }) {
  const { t } = useTranslation(['runs', 'common']);
  const errorText = useErrorText();
  return (
    <ol className="border-t border-hairline">
      {targets.map((target, position) => {
        const label = targetLabel(target);
        const blocked = target.deleteBlocked || target.extrasBlocked;
        return (
          <li key={target.id} className="border-b border-hairline py-6">
            <div className="grid gap-6 md:grid-cols-[2.25rem_minmax(0,1.5fr)_minmax(0,1.1fr)_repeat(3,minmax(0,0.8fr))] md:items-start">
              <span className="page-header-index pt-0.5">{String(position + 1).padStart(2, '0')}</span>
              <div className="min-w-0">
                <p className="truncate font-display text-base font-medium tracking-tight">
                  {label.instanceName ?? t('detail.targets.unknownInstance', { id: target.targetId.slice(0, 8) })}
                </p>
                <p className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground" title={label.path ?? undefined}>
                  {label.path ?? '—'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {label.mode && (
                    <Badge plain variant={label.mode === 'mirror' ? 'info' : 'default'}>
                      {t(`detail.targets.mode.${label.mode}`)}
                    </Badge>
                  )}
                  <Badge plain variant="info">
                    {t(`common:operationMethod.${label.createMode}`)}
                  </Badge>
                  {target.suspect && <Badge variant="warning">{t('detail.targets.suspect')}</Badge>}
                  {blocked && <Badge variant="danger">{t('detail.targets.blocked')}</Badge>}
                </div>
              </div>
              <div className="space-y-2">
                <Coverage label={t('detail.targets.sourceScan')} complete={target.sourceComplete} />
                <Coverage label={t('detail.targets.targetScan')} complete={target.targetComplete} />
              </div>
              <Metric label={t('detail.targets.replace')}>{count(target.plannedReplaceCount)}</Metric>
              <Metric label={t('detail.targets.extras')}>{count(target.plannedExtraCount)}</Metric>
              <Metric label={t('detail.targets.budget')}>
                {target.deleteBudgetCount === null ? (
                  <span className="font-sans text-xs text-muted-foreground">{t('detail.targets.budgetUnlimited')}</span>
                ) : (
                  count(target.deleteBudgetCount)
                )}
                <span className="mt-1 block font-sans text-[11px] text-muted-foreground">
                  {t('detail.targets.observed')} {count(target.observedTargetFileCount)}
                </span>
              </Metric>
            </div>
            {blocked && target.blockReasons.length > 0 && (
              <div className="mt-5 rounded-2xl border border-danger/20 bg-danger/[0.04] p-4 md:ml-[3.75rem]">
                <p className="eyebrow flex items-center gap-2 text-danger">
                  <ShieldAlert size={13} aria-hidden="true" />
                  {t('detail.targets.reasons')}
                </p>
                <ul className="mt-3 space-y-1.5">
                  {target.blockReasons.map((code) => (
                    <li key={code} className="text-sm">
                      {errorText(code, code)}
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">{code}</span>
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
