// 任务详情的“配置”标签：源、目标表、定时与接下来的时间、过滤规则、高级设置，全部只读。
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyValue, Section } from '../../components/page';
import { ErrorState, LoadingState } from '../../components/states';
import { Endpoint, PathText, RelativeTime } from '../../components/text';
import { Badge } from '../../components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/table';
import { formatBytes, formatDuration, formatTimeFull } from '../../lib/format';
import type { useNextFireTimes } from './job-queries';
import type { JobView, Target } from './job-contract';

/** 配置标签属性。 */
interface JobConfigTabProps {
  /** 任务配置。 */
  job: JobView;
  /** 实例名查找。 */
  instanceName: (id: string) => string;
  /** 接下来的定时时间查询（仅启用定时时请求）。 */
  nextFire: ReturnType<typeof useNextFireTimes>;
}

/** 渲染等宽的过滤规则标签组。
 * @param props patterns 规则。
 * @returns 标签组或占位。
 * @throws 不适用。
 */
function Patterns({ patterns }: { patterns: string[] }) {
  if (patterns.length === 0)
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {patterns.map((pattern) => (
        <code
          key={pattern}
          translate="no"
          className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs"
        >
          {pattern}
        </code>
      ))}
    </span>
  );
}

/** 渲染单个目标的删除上限摘要。
 * @param props target 目标。
 * @returns 上限文字。
 * @throws 不适用。
 */
function DeleteLimits({ target }: { target: Target }) {
  const { t } = useTranslation('jobs');
  const { enabled, maxCount, maxPercent } = target.deleteLimits;
  if (!enabled)
    return <span className="text-warning">{t('detail.limitsOff')}</span>;
  const parts: ReactNode[] = [];
  if (maxCount !== null)
    parts.push(t('detail.limitCount', { count: maxCount }));
  if (maxPercent !== null)
    parts.push(t('detail.limitPercent', { percent: maxPercent }));
  return <span>{parts.join(' · ')}</span>;
}

/** 渲染任务配置。
 * @param props 任务、实例名查找与定时预览查询。
 * @returns 只读配置分区。
 * @throws 不适用。
 */
export function JobConfigTab({
  job,
  instanceName,
  nextFire,
}: JobConfigTabProps) {
  const { t } = useTranslation(['jobs', 'common']);
  const yesNo = (value: boolean) => (value ? t('detail.yes') : t('detail.no'));
  const unlimited = (value: number, render: (value: number) => ReactNode) =>
    value === 0 ? t('detail.unlimited') : render(value);
  const seconds = (value: number) =>
    value === 0 ? t('detail.none') : t('detail.seconds', { value });
  const { filters } = job;
  const noFilters =
    filters.include.length === 0 &&
    filters.exclude.length === 0 &&
    filters.minSizeBytes === null &&
    filters.maxSizeBytes === null;

  return (
    <div className="space-y-4">
      <Section title={t('detail.source')}>
        <KeyValue
          items={[
            {
              label: t('detail.instance'),
              value: instanceName(job.source.instanceId),
            },
            {
              label: t('detail.path'),
              value: <PathText path={job.source.path} />,
            },
            { label: t('detail.refresh'), value: yesNo(job.source.refresh) },
            {
              label: t('detail.password'),
              value: job.source.hasPassword
                ? t('detail.passwordSet')
                : t('detail.passwordNone'),
            },
            {
              label: t('detail.sourceDownloadConcurrency'),
              value: unlimited(job.sourceDownloadConcurrency, String),
            },
            {
              label: t('detail.sourceScanInterval'),
              value: seconds(job.sourceScanIntervalSeconds),
            },
          ]}
        />
      </Section>

      <Section flush title={t('detail.targets')}>
        <Table bare>
          <THead>
            <tr>
              <TH className="w-8">{t('detail.targetCol.index')}</TH>
              <TH>{t('detail.targetCol.endpoint')}</TH>
              <TH>{t('detail.targetCol.mode')}</TH>
              <TH>{t('detail.targetCol.createMode')}</TH>
              <TH>{t('detail.targetCol.concurrentFiles')}</TH>
              <TH>{t('detail.targetCol.chunkConcurrency')}</TH>
              <TH>{t('detail.targetCol.scanInterval')}</TH>
              <TH>{t('detail.targetCol.deleteLimits')}</TH>
              <TH>{t('detail.targetCol.refresh')}</TH>
              <TH>{t('detail.targetCol.password')}</TH>
            </tr>
          </THead>
          <TBody>
            {job.targets.map((target, index) => (
              <TR key={target.id}>
                <TD className="text-muted-foreground">{index + 1}</TD>
                <TD className="max-w-72">
                  <Endpoint
                    instance={instanceName(target.instanceId)}
                    path={target.path}
                  />
                </TD>
                <TD>
                  <Badge
                    tone={target.mode === 'mirror' ? 'warning' : 'neutral'}
                  >
                    {t(`common:targetMode.${target.mode}`)}
                  </Badge>
                </TD>
                <TD className="text-[13px]">
                  {t(`common:operationMethod.${target.createMode}`)}
                </TD>
                <TD className="text-[13px]">
                  {unlimited(target.concurrentFiles, String)}
                </TD>
                <TD className="text-[13px]">
                  {target.createMode === 'relay'
                    ? target.chunkConcurrency
                    : '—'}
                </TD>
                <TD className="text-[13px] whitespace-nowrap">
                  {seconds(target.scanIntervalSeconds)}
                </TD>
                <TD className="text-[13px] whitespace-nowrap">
                  <DeleteLimits target={target} />
                </TD>
                <TD className="text-[13px]">{yesNo(target.refresh)}</TD>
                <TD className="text-[13px]">
                  {target.hasPassword
                    ? t('detail.passwordSet')
                    : t('detail.passwordNone')}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('detail.schedule')}>
          <KeyValue
            items={[
              {
                label: t('detail.cron'),
                value: job.cron ? (
                  <code translate="no" className="font-mono text-[12.5px]">
                    {job.cron}
                  </code>
                ) : (
                  t('detail.manualOnly')
                ),
              },
              { label: t('detail.timezone'), value: job.timezone },
              {
                label: t('detail.scheduleState'),
                value: !job.cron
                  ? '—'
                  : job.enabled
                    ? t('detail.scheduleOn')
                    : t('detail.scheduleOffState'),
              },
              {
                label: t('detail.nextFireTimes'),
                value:
                  !job.cron || !job.enabled ? (
                    '—'
                  ) : nextFire.isPending ? (
                    <LoadingState rows={2} />
                  ) : nextFire.isError ? (
                    <ErrorState
                      compact
                      error={nextFire.error}
                      onRetry={() => {
                        void nextFire.refetch();
                      }}
                    />
                  ) : nextFire.data.times.length === 0 ? (
                    t('detail.noUpcoming')
                  ) : (
                    <ol className="space-y-0.5 tabular-nums">
                      {nextFire.data.times.map((time) => (
                        <li key={time} className="flex gap-2">
                          <span>{formatTimeFull(time)}</span>
                          <RelativeTime
                            iso={time}
                            className="text-muted-foreground"
                          />
                        </li>
                      ))}
                    </ol>
                  ),
              },
            ]}
          />
        </Section>

        <Section title={t('detail.filters')}>
          {noFilters ? (
            <p className="text-[13px] text-muted-foreground">
              {t('detail.noFilters')}
            </p>
          ) : (
            <KeyValue
              items={[
                {
                  label: t('detail.include'),
                  value: <Patterns patterns={filters.include} />,
                },
                {
                  label: t('detail.exclude'),
                  value: <Patterns patterns={filters.exclude} />,
                },
                {
                  label: t('detail.minSize'),
                  value: formatBytes(filters.minSizeBytes),
                },
                {
                  label: t('detail.maxSize'),
                  value: formatBytes(filters.maxSizeBytes),
                },
              ]}
            />
          )}
        </Section>
      </div>

      <Section title={t('detail.advanced')}>
        <KeyValue
          className="lg:grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)_minmax(7rem,max-content)_minmax(0,1fr)]"
          items={[
            {
              label: t('detail.allowEmptySource'),
              value: yesNo(job.allowEmptySource),
            },
            {
              label: t('detail.syncEmptyDirs'),
              value: yesNo(job.syncEmptyDirs),
            },
            {
              label: t('detail.bandwidth'),
              value: unlimited(job.relayBandwidthLimit, (value) =>
                t('detail.bandwidthValue', { value: formatBytes(value) }),
              ),
            },
            {
              label: t('detail.retryCount'),
              value:
                job.retryCount === null
                  ? t('detail.retryInherited')
                  : job.retryCount,
            },
            {
              label: t('detail.timeout'),
              value: formatDuration(job.timeoutSeconds),
            },
            {
              label: t('detail.created'),
              value: <RelativeTime iso={job.createdAt} />,
            },
            {
              label: t('detail.updated'),
              value: <RelativeTime iso={job.updatedAt} />,
            },
          ]}
        />
      </Section>
    </div>
  );
}
