// 统计条：四个大号数字以发丝线分隔，数字从当前值滚动到新值，可点击的格子带悬停柔光。
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CountUp } from '../../components/motion/count-up';
import { StatusDot } from '../../components/ui/status-dot';
import { cn } from '../../lib/utils';
import type { DashboardInstance, DashboardJob, HealthView } from './dashboard-contract';

/** 统计条属性。 */
interface StatStripProps {
  /** 已加载的实例。 */
  instances: DashboardInstance[];
  /** 已加载的任务。 */
  jobs: DashboardJob[];
  /** 实例总数（服务端）。 */
  instanceTotal: number;
  /** 任务总数（服务端）。 */
  jobTotal: number;
  /** 健康结果；失败时为 undefined。 */
  health: HealthView | undefined;
  /** 健康检查是否失败。 */
  healthFailed: boolean;
}

/** 渲染单个统计格。
 * @param props label 标签；figure 主数字或文字；sub 说明；to 可选链接；tone 主数字颜色；className 分隔线位置。
 * @returns 统计格。
 * @throws 不适用。
 */
function StatCell({
  label,
  figure,
  sub,
  to,
  tone = 'default',
  className: edges,
}: {
  label: string;
  figure: ReactNode;
  sub: ReactNode;
  to?: string;
  tone?: 'default' | 'accent' | 'warning';
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        {to && (
          <ArrowUpRight
            size={14}
            className="text-muted-foreground opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-accent group-hover:opacity-100"
            aria-hidden="true"
          />
        )}
      </div>
      <div
        className={cn(
          'stat-figure mt-6',
          tone === 'accent' && 'text-accent',
          tone === 'warning' && 'text-signal',
        )}
      >
        {figure}
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{sub}</p>
    </>
  );
  const className = cn(
    'group relative block border-hairline px-5 py-7 transition-colors duration-300 sm:px-7 hover:bg-white/[0.015]',
    edges,
  );
  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** 渲染概览统计条。
 * @param props 实例、任务、总数与健康状态。
 * @returns 统计条。
 * @throws 不适用。
 */
export function StatStrip({ instances, jobs, instanceTotal, jobTotal, health, healthFailed }: StatStripProps) {
  const { t } = useTranslation('dashboard');
  const ready = instances.filter((item) => item.authState === 'ready').length;
  const blocked = instances.filter((item) => item.authState === 'auth_blocked').length;
  const scheduled = jobs.filter((job) => job.enabled && job.cron).length;
  const systemOk = health?.status === 'ok';

  return (
    // 移动端两列、桌面端四列，分隔线按格子位置显式指定，避免双线。
    <div className="grid grid-cols-2 border-y border-hairline lg:grid-cols-4">
      <StatCell
        className="border-r border-b lg:border-b-0"
        to="/instances"
        label={t('stats.instances')}
        tone={blocked > 0 ? 'warning' : 'default'}
        figure={<CountUp value={instanceTotal} />}
        sub={t('stats.instancesSub', { ready, blocked, loaded: instances.length })}
      />
      <StatCell
        className="border-b lg:border-r lg:border-b-0"
        to="/jobs"
        label={t('stats.jobs')}
        figure={<CountUp value={jobTotal} />}
        sub={t('stats.jobsSub', { scheduled, loaded: jobs.length })}
      />
      <StatCell
        className="border-r"
        label={t('stats.system')}
        tone={health ? (systemOk ? 'accent' : 'warning') : 'default'}
        figure={
          <span className="inline-flex items-center gap-3">
            {health && <StatusDot tone={systemOk ? 'success' : 'warning'} pulse={systemOk} className="size-2.5" />}
            {health
              ? systemOk
                ? t('stats.systemOk')
                : t('stats.systemNotReady')
              : healthFailed
                ? t('stats.systemUnavailable')
                : '—'}
          </span>
        }
        sub={
          health
            ? t(`stats.database.${health.database}`)
            : healthFailed
              ? t('stats.healthFailed')
              : t('stats.checking')
        }
      />
      <StatCell
        to="/jobs"
        label={t('stats.schedules')}
        figure={<CountUp value={scheduled} />}
        sub={t('stats.schedulesSub')}
      />
    </div>
  );
}
