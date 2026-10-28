// 概览页：一眼看清是否有事要处理——指标卡、需要处理、正在运行、即将运行与最近运行；本页持有任务与实例目录的轮询。
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader, useDocumentTitle } from '../../components/page';
import { Button } from '../../components/ui/button';
import { useInstanceCatalog } from '../instances/instance-queries';
import { useJobCatalog } from '../jobs/job-queries';
import { JobTriggerDialog } from '../jobs/job-trigger-dialog';
import type { JobListItem } from '../jobs/job-contract';
import { activeRunsByJob, useActiveRuns } from '../runs/run-queries';
import { KpiRow } from './overview-kpis';
import {
  AttentionSection,
  OnboardingSection,
  RunningSection,
  UpcomingSection,
} from './overview-sections';
import { RecentRunsSection } from './recent-runs';

/** 渲染概览页。
 * @returns 概览页面。
 * @throws 不适用；请求错误在各分区内显示。
 */
export function OverviewPage() {
  const { t } = useTranslation(['dashboard', 'common']);
  useDocumentTitle(t('common:nav.overview'));
  const jobs = useJobCatalog({ poll: true });
  const instances = useInstanceCatalog({ poll: true });
  // 活动运行由外壳持有轮询，这里只读同一缓存。
  const active = useActiveRuns();
  const activeByJob = useMemo(
    () => activeRunsByJob(active.data),
    [active.data],
  );
  const [running, setRunning] = useState<JobListItem | null>(null);

  // 两个目录都成功加载后才判断是否首次使用，避免加载中误显示引导。
  const firstUse =
    jobs.data !== undefined &&
    instances.data !== undefined &&
    (instances.data.length === 0 || jobs.data.length === 0);

  return (
    <section>
      <PageHeader
        title={t('title')}
        actions={
          <>
            <Button asChild>
              <Link to="/instances/new">
                <Plus size={14} aria-hidden="true" />
                {t('actions.newInstance')}
              </Link>
            </Button>
            <Button asChild>
              <Link to="/jobs/new">
                <Plus size={14} aria-hidden="true" />
                {t('actions.newJob')}
              </Link>
            </Button>
          </>
        }
      />

      <KpiRow active={active} jobs={jobs} instances={instances} />

      {firstUse ? (
        <OnboardingSection
          hasInstances={instances.data.length > 0}
          hasJobs={jobs.data.length > 0}
        />
      ) : (
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          <AttentionSection
            jobs={jobs}
            instances={instances}
            activeByJob={activeByJob}
            activityKnown={active.data !== undefined}
            onRun={setRunning}
          />
          <div className="grid content-start gap-4">
            <RunningSection active={active} />
            <UpcomingSection jobs={jobs} />
          </div>
        </div>
      )}

      <RecentRunsSection />

      <JobTriggerDialog job={running} onClose={() => setRunning(null)} />
    </section>
  );
}
