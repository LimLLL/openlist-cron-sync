// 任务列表与详情共用的展示片段：实例名查找、定时文本、目标摘要、当前运行与上次正式运行。
import { useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { RunStatusBadge } from '../../components/status';
import { Endpoint, RelativeTime, useClock } from '../../components/text';
import { Badge } from '../../components/ui/badge';
import { Tip } from '../../components/ui/tooltip';
import { useErrorText } from '../../i18n/error-text';
import { formatDuration } from '../../lib/format';
import { useInstanceCatalog } from '../instances/instance-queries';
import type { RunListItem } from '../runs/run-contract';
import type { JobListItem, JobView } from './job-contract';

/** 读取实例目录并返回按 ID 取名称的函数；未知或已删除的实例显示 ID 前 8 位。
 * @returns (id) => 实例名称；目录不变时引用稳定，可作为 memo 依赖。
 * @throws 不适用。
 */
export function useInstanceName(): (id: string) => string {
  const catalog = useInstanceCatalog();
  const names = useMemo(
    () =>
      new Map(
        (catalog.data ?? []).map((instance) => [instance.id, instance.name]),
      ),
    [catalog.data],
  );
  return useCallback((id: string) => names.get(id) ?? id.slice(0, 8), [names]);
}

/** 计算运行至今的秒数：已开始从开始扫描算起，排队中从接受时算起。
 * @param run 进行中的运行。
 * @param now 当前时间戳（毫秒）。
 * @returns 已用秒数。
 * @throws 不适用。
 */
export function elapsedSeconds(
  run: Pick<RunListItem, 'startedAt' | 'createdAt'>,
  now: number,
): number {
  const start = Date.parse(run.startedAt ?? run.createdAt);
  return Number.isNaN(start)
    ? 0
    : Math.max(0, Math.round((now - start) / 1000));
}

/** 渲染定时：Cron 与时区、“仅手动”，以及停用与定时错误提示。
 * @param props job 任务（列表项可带定时诊断）。
 * @returns 定时文本。
 * @throws 不适用。
 */
export function ScheduleText({
  job,
}: {
  job: Pick<JobView, 'cron' | 'timezone' | 'enabled'> &
    Partial<Pick<JobListItem, 'scheduleError'>>;
}) {
  const { t } = useTranslation(['jobs', 'common']);
  const errorText = useErrorText();
  if (!job.cron)
    return (
      <span className="text-muted-foreground">{t('list.manualOnly')}</span>
    );
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span translate="no" className="font-mono text-[12.5px]">
          {job.cron}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {job.timezone}
        </span>
      </span>
      {job.scheduleError ? (
        <Tip
          content={errorText(job.scheduleError.code, job.scheduleError.message)}
        >
          <span tabIndex={0} className="w-fit text-xs text-danger">
            {t('common:attention.scheduleError')}
          </span>
        </Tip>
      ) : (
        !job.enabled && (
          <span className="text-xs text-muted-foreground">
            {t('list.scheduleOff')}
          </span>
        )
      )}
    </span>
  );
}

/** 渲染目标摘要：首个目标端点、其余数量（悬停列出全部）与镜像标记。
 * @param props job 任务；instanceName 实例名查找。
 * @returns 目标单元格内容。
 * @throws 不适用。
 */
export function TargetsSummary({
  job,
  instanceName,
}: {
  job: Pick<JobView, 'targets'>;
  instanceName: (id: string) => string;
}) {
  const { t } = useTranslation('jobs');
  const [first, ...rest] = job.targets;
  const mirror = job.targets.some((target) => target.mode === 'mirror');
  if (!first) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Endpoint
        instance={instanceName(first.instanceId)}
        path={first.path}
        className="min-w-0"
      />
      {rest.length > 0 && (
        <Tip
          content={
            <span className="block space-y-0.5">
              {job.targets.map((target) => (
                <span key={target.id} className="block">
                  {instanceName(target.instanceId)} · {target.path}
                </span>
              ))}
            </span>
          }
        >
          <span
            tabIndex={0}
            className="shrink-0 rounded bg-surface-2 px-1 text-xs text-muted-foreground tabular-nums"
          >
            {t('list.moreTargets', { count: rest.length })}
          </span>
        </Tip>
      )}
      {mirror && (
        <Badge tone="warning" className="shrink-0">
          {t('list.mirror')}
        </Badge>
      )}
    </span>
  );
}

/** 渲染进行中的运行：状态徽标、试运行标记与已用时间，链接到运行详情。
 * @param props run 进行中的运行。
 * @returns 运行链接。
 * @throws 不适用。
 */
export function ActiveRunLink({ run }: { run: RunListItem }) {
  const { t } = useTranslation(['jobs', 'common']);
  // 共享时钟每 30 秒触发一次重新渲染，已用时间随之推进。
  useClock();
  return (
    <Link
      to={`/runs/${run.id}`}
      className="inline-flex min-w-0 items-center gap-1.5 hover:underline"
    >
      <RunStatusBadge status={run.status} />
      {run.dryRun && <Badge>{t('common:dryRun')}</Badge>}
      <span className="truncate text-xs text-muted-foreground tabular-nums">
        {t('list.elapsed', {
          duration: formatDuration(elapsedSeconds(run, Date.now())),
        })}
      </span>
    </Link>
  );
}

/** 渲染最近一次终态正式运行：状态、结束时间，悬停显示错误；没有时显示占位文字。
 * @param props run 摘要或 null。
 * @returns 运行链接或占位。
 * @throws 不适用。
 */
export function LastRealRun({
  run,
}: {
  run: JobListItem['latestTerminalRealRun'];
}) {
  const { t } = useTranslation('jobs');
  const errorText = useErrorText();
  if (!run)
    return <span className="text-muted-foreground">{t('list.noRealRun')}</span>;
  const link = (
    <Link
      to={`/runs/${run.id}`}
      className="inline-flex min-w-0 items-center gap-1.5 hover:underline"
    >
      <RunStatusBadge status={run.status} stopReason={run.stopReason} />
      <RelativeTime
        iso={run.endedAt}
        className="truncate text-xs text-muted-foreground"
      />
    </Link>
  );
  if (!run.error) return link;
  return (
    <Tip content={errorText(run.error.code, run.error.message)}>{link}</Tip>
  );
}
