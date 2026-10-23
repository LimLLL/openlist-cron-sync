// 任务详情的编辑式分节：定时、目标与删除阈值、过滤规则、高级设置、时间线。
import { useTranslation } from 'react-i18next';
import { EditorialSection } from '../../components/ui/editorial-section';
import { Badge } from '../../components/ui/badge';
import { SpecGrid } from '../../components/ui/spec-grid';
import { ErrorState } from '../../components/states';
import {
  formatBytes,
  formatDuration,
  formatRelative,
  formatTimeFull,
} from '../../lib/format';
import { useNextFireTimes } from './job-queries';
import { MonoChip, useInstanceName } from './job-ui';
import type { JobView } from './job-contract';

/** 渲染定时分节：Cron、时区、状态与下次触发时间。
 * @param props job 任务；index 分节编号。
 * @returns 分节。
 * @throws 不适用。
 */
export function ScheduleSection({
  job,
  index,
}: {
  job: JobView;
  index: string;
}) {
  const { t } = useTranslation('jobs');
  const scheduled = !!job.cron && job.enabled && !job.archivedAt;
  const fireTimes = useNextFireTimes(job.id, scheduled);
  return (
    <EditorialSection
      index={index}
      title={t('detail.schedule')}
      description={t('detail.scheduleDesc')}
    >
      <SpecGrid
        columns={3}
        className="grid-cols-2"
        items={[
          {
            label: t('detail.cron'),
            value: job.cron ?? t('detail.manualOnly'),
            mono: !!job.cron,
          },
          { label: t('detail.timezone'), value: job.timezone, mono: true },
          {
            label: t('detail.scheduleState'),
            value: job.enabled ? t('badge.enabled') : t('badge.disabled'),
          },
        ]}
      />
      {!job.cron && (
        <p className="mt-5 text-sm text-muted-foreground">
          {t('detail.manualHint')}
        </p>
      )}
      {job.cron && !job.enabled && (
        <p className="mt-5 text-sm text-muted-foreground">
          {t('detail.scheduleOff')}
        </p>
      )}
      {scheduled && fireTimes.error && (
        <div className="mt-5">
          <ErrorState
            error={fireTimes.error}
            onRetry={() => void fireTimes.refetch()}
          />
        </div>
      )}
      {scheduled && fireTimes.data && fireTimes.data.times.length > 0 && (
        <div className="mt-8">
          <p className="eyebrow mb-3">{t('detail.nextFireTimes')}</p>
          <ol className="border-t border-hairline">
            {fireTimes.data.times.map((time, position) => (
              <li
                key={time}
                className="flex items-baseline gap-4 border-b border-hairline py-3 font-mono text-[12.5px]"
              >
                <span className="w-6 text-accent">
                  {String(position + 1).padStart(2, '0')}
                </span>
                <span className="flex-1">{formatTimeFull(time)}</span>
                <span className="text-muted-foreground">
                  {formatRelative(time)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </EditorialSection>
  );
}

/** 渲染目标与删除阈值分节，每个目标一组规格。
 * @param props job 任务；index 分节编号。
 * @returns 分节。
 * @throws 不适用。
 */
export function TargetsSection({
  job,
  index,
}: {
  job: JobView;
  index: string;
}) {
  const { t } = useTranslation('jobs');
  const instanceName = useInstanceName();
  /** 并发配额的展示值，0 显示为“不限”。
   * @param value 配额。
   * @returns 展示文本。
   * @throws 不适用。
   */
  const concurrency = (value: number) =>
    value === 0 ? t('detail.unlimited') : String(value);
  return (
    <EditorialSection
      index={index}
      title={t('detail.targets')}
      description={t('detail.targetsDesc')}
    >
      <div className="space-y-8">
        {job.targets.map((target, position) => (
          <div key={target.id}>
            <div className="mb-3 flex items-baseline gap-3">
              <span className="font-mono text-[11px] text-accent">
                {`T${String(position + 1).padStart(2, '0')}`}
              </span>
              <span className="text-sm font-medium">
                {instanceName(target.instanceId) ?? t('detail.unknownInstance')}
              </span>
              <span className="truncate font-mono text-[12px] text-muted-foreground">
                {target.path}
              </span>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge
                plain
                variant={target.mode === 'mirror' ? 'warning' : 'default'}
              >
                {t(`mode.${target.mode}`)}
              </Badge>
              <Badge plain variant="info">
                {t(`createMode.${target.createMode}`)}
              </Badge>
            </div>
            <SpecGrid
              columns={3}
              className="grid-cols-2"
              items={[
                {
                  label: t('detail.concurrentFiles'),
                  value: concurrency(target.concurrentFiles),
                  mono: target.concurrentFiles !== 0,
                },
                // 分片并发只作用于中转；服务端复制不显示该项。
                ...(target.createMode === 'relay'
                  ? [
                      {
                        label: t('detail.chunkConcurrency'),
                        value: String(target.chunkConcurrency),
                        mono: true,
                      },
                    ]
                  : []),
                {
                  label: t('detail.deleteLimits'),
                  value: target.deleteLimits.enabled
                    ? t('detail.limitsEnabled')
                    : t('detail.limitsDisabled'),
                },
                {
                  label: t('detail.maxCount'),
                  value:
                    target.deleteLimits.maxCount?.toString() ??
                    t('detail.unlimited'),
                  mono: target.deleteLimits.maxCount !== null,
                },
                {
                  label: t('detail.maxPercent'),
                  value:
                    target.deleteLimits.maxPercent !== null
                      ? `${target.deleteLimits.maxPercent}%`
                      : t('detail.unlimited'),
                  mono: target.deleteLimits.maxPercent !== null,
                },
                {
                  label: t('detail.refresh'),
                  value: target.refresh ? t('detail.yes') : t('detail.no'),
                },
                {
                  label: t('detail.password'),
                  value: target.hasPassword
                    ? t('detail.passwordSet')
                    : t('detail.passwordNone'),
                },
              ]}
            />
          </div>
        ))}
      </div>
    </EditorialSection>
  );
}

/** 渲染过滤规则分节；没有任何规则时给出明确说明。
 * @param props job 任务；index 分节编号。
 * @returns 分节。
 * @throws 不适用。
 */
export function FiltersSection({
  job,
  index,
}: {
  job: JobView;
  index: string;
}) {
  const { t } = useTranslation('jobs');
  const { include, exclude, minSizeBytes, maxSizeBytes } = job.filters;
  const empty =
    include.length === 0 &&
    exclude.length === 0 &&
    minSizeBytes === null &&
    maxSizeBytes === null;
  return (
    <EditorialSection
      index={index}
      title={t('detail.filters')}
      description={t('detail.filtersDesc')}
    >
      {empty ? (
        <p className="text-sm text-muted-foreground">{t('detail.noFilters')}</p>
      ) : (
        <div className="space-y-6">
          {[
            { label: t('detail.include'), patterns: include },
            { label: t('detail.exclude'), patterns: exclude },
          ]
            .filter((group) => group.patterns.length > 0)
            .map((group) => (
              <div key={group.label}>
                <p className="eyebrow mb-3">{group.label}</p>
                <div className="flex flex-wrap gap-2">
                  {group.patterns.map((pattern) => (
                    <MonoChip key={pattern}>{pattern}</MonoChip>
                  ))}
                </div>
              </div>
            ))}
          {(minSizeBytes !== null || maxSizeBytes !== null) && (
            <SpecGrid
              columns={2}
              className="grid-cols-2"
              items={[
                {
                  label: t('detail.minSize'),
                  value:
                    minSizeBytes === null
                      ? t('detail.unlimited')
                      : formatBytes(minSizeBytes),
                  mono: minSizeBytes !== null,
                },
                {
                  label: t('detail.maxSize'),
                  value:
                    maxSizeBytes === null
                      ? t('detail.unlimited')
                      : formatBytes(maxSizeBytes),
                  mono: maxSizeBytes !== null,
                },
              ]}
            />
          )}
        </div>
      )}
    </EditorialSection>
  );
}

/** 渲染高级设置分节。
 * @param props job 任务；index 分节编号。
 * @returns 分节。
 * @throws 不适用。
 */
export function AdvancedSection({
  job,
  index,
}: {
  job: JobView;
  index: string;
}) {
  const { t } = useTranslation('jobs');
  const yesNo = (value: boolean) => (value ? t('detail.yes') : t('detail.no'));
  return (
    <EditorialSection
      index={index}
      title={t('detail.advanced')}
      description={t('detail.advancedDesc')}
    >
      <SpecGrid
        columns={3}
        className="grid-cols-2"
        items={[
          {
            label: t('detail.allowEmptySource'),
            value: yesNo(job.allowEmptySource),
          },
          { label: t('detail.syncEmptyDirs'), value: yesNo(job.syncEmptyDirs) },
          {
            label: t('detail.sourceDownloadConcurrency'),
            value:
              job.sourceDownloadConcurrency === 0
                ? t('detail.unlimited')
                : String(job.sourceDownloadConcurrency),
            mono: job.sourceDownloadConcurrency !== 0,
          },
          {
            label: t('detail.bandwidth'),
            value:
              job.relayBandwidthLimit === 0
                ? t('detail.unlimited')
                : t('detail.bandwidthValue', {
                    value: formatBytes(job.relayBandwidthLimit),
                  }),
            mono: job.relayBandwidthLimit !== 0,
          },
          {
            label: t('detail.retryCount'),
            value:
              job.retryCount === null
                ? t('detail.retryInherited')
                : String(job.retryCount),
            mono: job.retryCount !== null,
          },
          {
            label: t('detail.timeout'),
            value: formatDuration(job.timeoutSeconds),
            mono: true,
          },
          {
            label: t('detail.sourcePassword'),
            value: job.source.hasPassword
              ? t('detail.passwordSet')
              : t('detail.passwordNone'),
          },
        ]}
      />
    </EditorialSection>
  );
}

/** 渲染配置时间线分节。
 * @param props job 任务；index 分节编号。
 * @returns 分节。
 * @throws 不适用。
 */
export function TimelineSection({
  job,
  index,
}: {
  job: JobView;
  index: string;
}) {
  const { t } = useTranslation('jobs');
  return (
    <EditorialSection
      index={index}
      title={t('detail.timeline')}
      description={t('detail.timelineDesc')}
    >
      <SpecGrid
        columns={3}
        items={[
          {
            label: t('detail.created'),
            value: formatTimeFull(job.createdAt),
            mono: true,
          },
          {
            label: t('detail.updated'),
            value: formatTimeFull(job.updatedAt),
            mono: true,
          },
          {
            label: t('detail.archived'),
            value: job.archivedAt
              ? formatTimeFull(job.archivedAt)
              : t('detail.active'),
            mono: !!job.archivedAt,
          },
        ]}
      />
    </EditorialSection>
  );
}
