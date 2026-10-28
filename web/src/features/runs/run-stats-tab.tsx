// 运行详情的“统计”与“配置”标签：按扫描/计划/结果/字节分组的非零计数；运行设置与冻结的配置快照原文。
import { useTranslation } from 'react-i18next';
import { KeyValue, Section } from '../../components/page';
import type { Fact } from '../../components/page';
import { ShortId } from '../../components/text';
import { formatBytes, formatTimeFull } from '../../lib/format';
import {
  formatCount,
  isByteStat,
  isStatKey,
  readableKey,
  STAT_GROUPS,
} from './run-format';
import type { RunDetail } from './run-contract';

/** 渲染分组统计；只显示非零项，未知键归入“其他”。
 * @param props run 运行详情。
 * @returns 统计分组或空提示。
 * @throws 不适用。
 */
export function RunStatsTab({ run }: { run: RunDetail }) {
  const { t } = useTranslation('runs');
  const value = (key: string, amount: number) =>
    isByteStat(key) ? formatBytes(amount) : formatCount(amount);
  const groups: Array<{ title: string; items: Fact[] }> = (
    Object.keys(STAT_GROUPS) as Array<keyof typeof STAT_GROUPS>
  ).map((group) => ({
    title: t(`detail.stats.groups.${group}`),
    items: STAT_GROUPS[group]
      .filter((key) => (run.stats[key] ?? 0) > 0)
      .map((key) => ({
        label: t(`detail.stats.${key}`),
        value: value(key, run.stats[key] ?? 0),
      })),
  }));
  const other = Object.entries(run.stats)
    .filter(([key, amount]) => !isStatKey(key) && amount > 0)
    .map(([key, amount]) => ({
      label: readableKey(key),
      value: value(key, amount),
    }));
  groups.push({ title: t('detail.stats.groups.other'), items: other });
  const visible = groups.filter((group) => group.items.length > 0);

  if (visible.length === 0)
    return (
      <p className="py-8 text-center text-[13px] text-muted-foreground">
        {t('detail.noStats')}
      </p>
    );
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {visible.map((group) => (
        <Section key={group.title} title={group.title}>
          <KeyValue items={group.items} />
        </Section>
      ))}
    </div>
  );
}

/** 渲染运行设置与配置快照原文。
 * @param props run 运行详情。
 * @returns 配置标签内容。
 * @throws 不适用。
 */
export function RunConfigTab({ run }: { run: RunDetail }) {
  const { t } = useTranslation(['runs', 'common']);
  const settings: Fact[] = [
    { label: t('detail.settings.id'), value: <ShortId id={run.id} /> },
    {
      label: t('detail.settings.trigger'),
      value: t(`detail.trigger.${run.trigger}`),
    },
  ];
  if (run.scheduledAt)
    settings.push({
      label: t('detail.settings.scheduledAt'),
      value: formatTimeFull(run.scheduledAt),
    });
  settings.push(
    {
      label: t('detail.settings.sourceInstance'),
      value: run.sourceInstanceName,
    },
    {
      label: t('detail.settings.deleteThresholds'),
      value: run.confirmDeletes ? (
        <span className="text-warning">
          {t('detail.settings.thresholdsOverridden')}
        </span>
      ) : (
        t('detail.settings.thresholdsEnforced')
      ),
    },
    {
      label: t('detail.settings.queueDeadline'),
      value: formatTimeFull(run.queueDeadlineAt),
    },
  );
  if (run.deadlineAt)
    settings.push({
      label: t('detail.settings.deadline'),
      value: formatTimeFull(run.deadlineAt),
    });

  return (
    <div className="space-y-3">
      <Section title={t('detail.settings.title')}>
        <KeyValue items={settings} />
      </Section>
      <Section
        title={t('detail.snapshot.title')}
        description={t('detail.snapshot.description')}
      >
        <details>
          <summary className="cursor-pointer text-[13px] text-link select-none">
            {t('detail.snapshot.show')}
          </summary>
          <pre
            translate="no"
            className="mt-3 max-h-[32rem] overflow-auto rounded-md bg-surface-2 p-3 font-mono text-xs leading-relaxed"
          >
            {JSON.stringify(run.config, null, 2)}
          </pre>
        </details>
      </Section>
    </div>
  );
}
