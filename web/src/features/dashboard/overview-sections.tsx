// 概览分区：需要处理（任务与实例）、正在运行、即将运行与首次使用引导；后台刷新失败时保留数据并提示可能过期。
import type { ReactNode } from 'react';
import { Check, Play } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Section } from '../../components/page';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { RunStatusBadge } from '../../components/status';
import { RelativeTime, useClock } from '../../components/text';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Tip } from '../../components/ui/tooltip';
import { useErrorText } from '../../i18n/error-text';
import {
  formatBytes,
  formatDuration,
  formatRelative,
  formatTime,
} from '../../lib/format';
import { cn } from '../../lib/utils';
import {
  InstanceHealthBadge,
  instanceNeedsAttention,
} from '../instances/instance-health';
import type { Instance } from '../instances/instance-contract';
import type { JobListItem } from '../jobs/job-contract';
import type { RunListItem } from '../runs/run-contract';
import { formatCount, runCounts } from '../runs/run-format';
import { attentionJobs, elapsedSeconds, upcomingJobs } from './overview-format';

/** 分区依赖的查询状态。
 * @template T 数据类型。
 */
export interface SectionQuery<T> {
  /** 已加载的数据。 */
  data: T | undefined;
  /** 请求错误；有数据时表示后台刷新失败。 */
  error: Error | null;
  /** 重新请求。 */
  refetch: () => unknown;
}

/** 后台刷新失败、仍显示旧数据时的一行提示。
 * @param props show 是否显示。
 * @returns 提示或 null。
 * @throws 不适用。
 */
function StaleNote({ show }: { show: boolean }) {
  const { t } = useTranslation('common');
  if (!show) return null;
  return (
    <p className="border-b border-border bg-warning/8 px-4 py-1.5 text-xs text-warning">
      {t('states.stale')}
    </p>
  );
}

/** 列表行容器：统一的内边距与分隔线。
 * @param props children 行内容。
 * @returns li 元素。
 * @throws 不适用。
 */
function Row({ children }: { children: ReactNode }) {
  return (
    <li className="flex min-h-12 items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
      {children}
    </li>
  );
}

/** 需要处理分区属性。 */
interface AttentionSectionProps {
  /** 任务目录查询。 */
  jobs: SectionQuery<JobListItem[]>;
  /** 实例目录查询。 */
  instances: SectionQuery<Instance[]>;
  /** 各任务当前的活动运行。 */
  activeByJob: Map<string, RunListItem>;
  /** 完整活动运行集合是否已成功读取，未知不能当作空闲。 */
  activityKnown: boolean;
  /** 打开运行选项对话框。 */
  onRun: (job: JobListItem) => void;
}

/** 渲染“需要处理”：最近一次正式运行出问题或定时无法执行的任务，以及封锁/出错的实例。
 * @param props 查询状态、活动运行与运行回调。
 * @returns 分区卡片。
 * @throws 不适用。
 */
export function AttentionSection({
  jobs,
  instances,
  activeByJob,
  activityKnown,
  onRun,
}: AttentionSectionProps) {
  const { t } = useTranslation(['dashboard', 'common']);
  const errorText = useErrorText();
  const jobRows = jobs.data ? attentionJobs(jobs.data) : [];
  const instanceRows = instances.data?.filter(instanceNeedsAttention) ?? [];
  // 任一目录仍在首次加载时，不能断言“一切正常”。
  const pending =
    (!jobs.data && !jobs.error) || (!instances.data && !instances.error);
  const hasRows = jobRows.length + instanceRows.length > 0;
  const empty =
    !hasRows && jobs.data !== undefined && instances.data !== undefined;

  return (
    <Section title={t('attention.title')} flush>
      <StaleNote
        show={
          (jobs.error !== null && jobs.data !== undefined) ||
          (instances.error !== null && instances.data !== undefined)
        }
      />
      {jobs.error && !jobs.data && (
        <div className="border-b border-border p-3">
          <ErrorState
            error={jobs.error}
            onRetry={() => void jobs.refetch()}
            compact
          />
        </div>
      )}
      {instances.error && !instances.data && (
        <div className="border-b border-border p-3">
          <ErrorState
            error={instances.error}
            onRetry={() => void instances.refetch()}
            compact
          />
        </div>
      )}
      {empty && (
        <EmptyState
          compact
          title={t('attention.empty')}
          description={t('attention.emptyDescription')}
        />
      )}
      {!hasRows && pending && (
        <div className="px-4 py-3">
          <LoadingState label={t('attention.loading')} rows={3} />
        </div>
      )}
      {hasRows && (
        <ul>
          {jobRows.map(({ job, reasons }) => {
            const run = job.latestTerminalRealRun;
            const busy = activeByJob.has(job.id) || !activityKnown;
            // 定时错误与运行问题可能同时存在：说明文字列出全部原因，补充信息优先显示运行错误。
            const detail = run?.error
              ? errorText(run.error.code, run.error.message)
              : job.scheduleError
                ? errorText(job.scheduleError.code, job.scheduleError.message)
                : null;
            return (
              <Row key={job.id}>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/jobs/${job.id}`}
                    className="block truncate text-[13px] font-medium hover:underline"
                  >
                    {job.name}
                  </Link>
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={detail ?? undefined}
                  >
                    {reasons
                      .map((reason) => t(`common:attention.${reason}`))
                      .join(' · ')}
                    {detail && ` — ${detail}`}
                  </p>
                </div>
                {run &&
                  reasons.some((reason) => reason !== 'scheduleError') && (
                    <Link
                      to={`/runs/${run.id}`}
                      className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <RunStatusBadge
                        status={run.status}
                        stopReason={run.stopReason}
                      />
                      <RelativeTime
                        iso={run.endedAt}
                        className="hidden sm:inline"
                      />
                    </Link>
                  )}
                <Tip
                  content={
                    !activityKnown
                      ? t('common:states.activityUnknown')
                      : busy
                        ? t('attention.busy')
                        : null
                  }
                >
                  {/* 禁用按钮不触发悬停与聚焦，外层可聚焦的 span 承载提示。 */}
                  <span className="shrink-0" tabIndex={busy ? 0 : undefined}>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => onRun(job)}
                    >
                      <Play size={12} aria-hidden="true" />
                      {t('common:actions.run')}
                    </Button>
                  </span>
                </Tip>
              </Row>
            );
          })}
          {instanceRows.map((instance) => (
            <Row key={instance.id}>
              <div className="min-w-0 flex-1">
                <Link
                  to={`/instances/${instance.id}`}
                  className="block truncate text-[13px] font-medium hover:underline"
                >
                  {instance.name}
                </Link>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={instance.lastError?.message}
                >
                  {instance.lastError
                    ? errorText(
                        instance.lastError.code,
                        instance.lastError.message,
                      )
                    : instance.lastTestAt
                      ? t('attention.lastTested', {
                          time: formatRelative(instance.lastTestAt),
                        })
                      : t('attention.neverTested')}
                </p>
              </div>
              <InstanceHealthBadge instance={instance} />
            </Row>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** 正在运行分区属性。 */
interface RunningSectionProps {
  /** 活动运行查询。 */
  active: SectionQuery<RunListItem[]>;
}

/** 渲染单条活动运行的进度事实：规划完成前只显示已用时间。
 * @param props run 活动运行；now 当前时间。
 * @returns 一行事实文字。
 * @throws 不适用。
 */
function RunFacts({ run, now }: { run: RunListItem; now: number }) {
  const { t } = useTranslation('dashboard');
  const queued = run.startedAt === null;
  const seconds = queued
    ? elapsedSeconds(run.createdAt, null, now)
    : elapsedSeconds(run.startedAt, null, now);
  const parts: string[] = [
    t(queued ? 'running.queued' : 'running.elapsed', {
      time: formatDuration(seconds),
    }),
  ];
  // 扫描完成前没有计划总量，不显示“已新建 X / Y”。
  if (run.status !== 'queued' && run.status !== 'scanning') {
    const counts = runCounts(run.stats);
    if (run.dryRun)
      parts.push(
        t('running.planned', {
          creates: formatCount(counts.plannedCreates),
          deletes: formatCount(counts.plannedDeletes),
        }),
      );
    else
      parts.push(
        t('running.created', {
          done: formatCount(counts.created),
          planned: formatCount(counts.plannedCreates),
        }),
        t('running.transferred', {
          bytes: formatBytes(counts.transferred),
        }),
      );
  }
  return (
    <p className="truncate text-xs text-muted-foreground tabular-nums">
      {parts.join(' · ')}
    </p>
  );
}

/** 渲染“正在运行”：每条活动运行的状态、已用时间与事实计数（不估算百分比）。
 * @param props 活动运行查询。
 * @returns 分区卡片。
 * @throws 不适用。
 */
export function RunningSection({ active }: RunningSectionProps) {
  const { t } = useTranslation(['dashboard', 'common']);
  const now = useClock();
  const runs = active.data;
  return (
    <Section title={t('running.title')} flush>
      <StaleNote show={active.error !== null && runs !== undefined} />
      {!runs ? (
        active.error ? (
          <div className="p-3">
            <ErrorState
              error={active.error}
              onRetry={() => void active.refetch()}
              compact
            />
          </div>
        ) : (
          <div className="px-4 py-3">
            <LoadingState rows={2} />
          </div>
        )
      ) : runs.length === 0 ? (
        <EmptyState compact title={t('running.empty')} />
      ) : (
        <ul>
          {runs.map((run) => (
            <Row key={run.id}>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <Link
                    to={`/runs/${run.id}`}
                    className="truncate text-[13px] font-medium hover:underline"
                  >
                    {run.jobName}
                  </Link>
                  {run.dryRun && <Badge>{t('common:dryRun')}</Badge>}
                </div>
                <RunFacts run={run} now={now} />
              </div>
              <RunStatusBadge status={run.status} stopReason={run.stopReason} />
            </Row>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** 渲染“即将运行”：按下次定时时间排序的前 5 个任务。
 * @param props jobs 任务目录查询。
 * @returns 分区卡片。
 * @throws 不适用。
 */
export function UpcomingSection({
  jobs,
}: {
  jobs: SectionQuery<JobListItem[]>;
}) {
  const { t } = useTranslation('dashboard');
  const items = jobs.data ? upcomingJobs(jobs.data, 5) : undefined;
  return (
    <Section title={t('upcoming.title')} flush>
      <StaleNote show={jobs.error !== null && jobs.data !== undefined} />
      {!items ? (
        jobs.error ? (
          <div className="p-3">
            <ErrorState
              error={jobs.error}
              onRetry={() => void jobs.refetch()}
              compact
            />
          </div>
        ) : (
          <div className="px-4 py-3">
            <LoadingState rows={2} />
          </div>
        )
      ) : items.length === 0 ? (
        <EmptyState compact title={t('upcoming.empty')} />
      ) : (
        <ul>
          {items.map((job) => (
            <Row key={job.id}>
              <div className="w-28 shrink-0 tabular-nums">
                <p className="text-[13px] font-medium">
                  {formatTime(job.nextFireAt)}
                </p>
                <RelativeTime
                  iso={job.nextFireAt}
                  className="block text-xs text-muted-foreground"
                />
              </div>
              <div className="min-w-0 flex-1">
                <Link
                  to={`/jobs/${job.id}`}
                  className="block truncate text-[13px] hover:underline"
                >
                  {job.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  <span translate="no" className="font-mono">
                    {job.cron}
                  </span>
                  <span className="ml-1.5">{job.timezone}</span>
                </p>
              </div>
            </Row>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** 渲染首次使用引导：添加实例 → 新建任务 → 运行；已完成的步骤打勾。
 * @param props hasInstances 是否已有实例；hasJobs 是否已有任务。
 * @returns 分区卡片。
 * @throws 不适用。
 */
export function OnboardingSection({
  hasInstances,
  hasJobs,
}: {
  hasInstances: boolean;
  hasJobs: boolean;
}) {
  const { t } = useTranslation('dashboard');
  const steps = [
    { key: 'instance', to: '/instances/new', done: hasInstances },
    { key: 'job', to: '/jobs/new', done: hasJobs },
    { key: 'run', to: '/jobs', done: false },
  ] as const;
  return (
    <Section
      title={t('onboarding.title')}
      description={t('onboarding.description')}
      className="mb-4"
      flush
    >
      <ol className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {steps.map((step, index) => (
          <li key={step.key}>
            <Link
              to={step.to}
              className="flex h-full gap-3 px-4 py-3 transition-colors hover:bg-surface-2/50"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium tabular-nums',
                  step.done
                    ? 'border-success/30 bg-success/12 text-success'
                    : 'border-input text-muted-foreground',
                )}
              >
                {step.done ? <Check size={13} /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">
                  {t(`onboarding.${step.key}.title`)}
                  {step.done && (
                    <span className="sr-only"> ({t('onboarding.done')})</span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t(`onboarding.${step.key}.description`)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Section>
  );
}
