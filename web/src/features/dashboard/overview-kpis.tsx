// 概览顶部四个指标卡：运行中、需要处理的任务、需要关注的实例、下次定时；每张卡都是跳转到对应筛选的链接。
import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '../../components/skeleton';
import { RelativeTime } from '../../components/text';
import { cn } from '../../lib/utils';
import { instanceNeedsAttention } from '../instances/instance-health';
import type { Instance } from '../instances/instance-contract';
import type { JobListItem } from '../jobs/job-contract';
import type { RunListItem } from '../runs/run-contract';
import { attentionJobs, upcomingJobs } from './overview-format';

/** 指标卡依赖的查询状态。
 * @template T 数据类型。
 */
interface Loadable<T> {
  /** 已加载的数据；首次加载前为 undefined。 */
  data: T | undefined;
  /** 最近一次请求是否失败。 */
  isError: boolean;
}

/** 单张指标卡属性。 */
interface TileProps {
  /** 跳转目标。 */
  to: string;
  /** 标签。 */
  label: string;
  /** 数值或简短文本；undefined 表示仍在加载。 */
  value: ReactNode | undefined;
  /** 数值下方一行补充。 */
  sub?: ReactNode;
  /** 是否加载失败（且没有可显示的数据）。 */
  failed: boolean;
  /** 数值强调色。 */
  tone?: 'danger' | 'warning' | 'info';
}

const VALUE_TONES = {
  danger: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
} as const;

/** 渲染单张指标卡：首次加载显示骨架，失败显示“—”与错误提示。
 * @param props 标签、数值、补充与色调。
 * @returns 链接形式的指标卡。
 * @throws 不适用。
 */
function Tile({ to, label, value, sub, failed, tone }: TileProps) {
  const { t } = useTranslation('dashboard');
  return (
    <Link
      to={to}
      className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors hover:bg-surface-2/50"
    >
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      {failed ? (
        <>
          <p className="mt-1 text-xl font-semibold text-muted-foreground">—</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-danger">
            <CircleAlert size={12} aria-hidden="true" />
            {t('kpi.loadFailed')}
          </p>
        </>
      ) : value === undefined ? (
        // 与数值（28px 行高）和补充行（16px 行高）等高，加载完成时卡片不变高。
        <>
          <div className="mt-1 flex h-7 items-center">
            <Skeleton className="h-6 w-12" />
          </div>
          <div className="mt-0.5 flex h-4 items-center">
            <Skeleton className="h-3 w-24" />
          </div>
        </>
      ) : (
        <>
          <p
            className={cn(
              'mt-1 truncate text-xl leading-7 font-semibold tabular-nums',
              tone && VALUE_TONES[tone],
            )}
          >
            {value}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
        </>
      )}
    </Link>
  );
}

/** 指标行属性。 */
interface KpiRowProps {
  /** 活动运行。 */
  active: Loadable<RunListItem[]>;
  /** 任务目录。 */
  jobs: Loadable<JobListItem[]>;
  /** 实例目录。 */
  instances: Loadable<Instance[]>;
}

/** 渲染四个指标卡；宽屏一行四列，窄屏两列。
 * @param props 三个查询的状态。
 * @returns 指标行。
 * @throws 不适用。
 */
export function KpiRow({ active, jobs, instances }: KpiRowProps) {
  const { t } = useTranslation('dashboard');
  const running = active.data;
  const dry = running?.filter((run) => run.dryRun).length ?? 0;
  const attention = jobs.data ? attentionJobs(jobs.data).length : undefined;
  const unhealthy = instances.data?.filter(instanceNeedsAttention).length;
  const next = jobs.data ? upcomingJobs(jobs.data, 1)[0] : undefined;

  return (
    <section
      aria-label={t('kpi.label')}
      className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      <Tile
        to="/runs?status=active"
        label={t('kpi.running')}
        value={running?.length}
        sub={
          running && t('kpi.runningSub', { real: running.length - dry, dry })
        }
        failed={active.isError && !running}
        tone={running?.length ? 'info' : undefined}
      />
      <Tile
        to="/jobs?filter=attention"
        label={t('kpi.attentionJobs')}
        value={attention}
        sub={
          jobs.data && t('kpi.attentionJobsSub', { count: jobs.data.length })
        }
        failed={jobs.isError && !jobs.data}
        tone={attention ? 'danger' : undefined}
      />
      <Tile
        to="/instances?filter=attention"
        label={t('kpi.attentionInstances')}
        value={unhealthy}
        sub={
          instances.data &&
          t('kpi.attentionInstancesSub', { count: instances.data.length })
        }
        failed={instances.isError && !instances.data}
        tone={unhealthy ? 'warning' : undefined}
      />
      <Tile
        to={next ? `/jobs/${next.id}` : '/jobs'}
        label={t('kpi.nextFire')}
        value={
          jobs.data &&
          (next ? (
            <RelativeTime iso={next.nextFireAt} />
          ) : (
            <span className="text-muted-foreground">—</span>
          ))
        }
        sub={next ? next.name : t('kpi.nextFireNone')}
        failed={jobs.isError && !jobs.data}
      />
    </section>
  );
}
