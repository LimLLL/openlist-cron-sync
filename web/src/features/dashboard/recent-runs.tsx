// 概览“最近运行”表：最新 10 次运行的状态、类型、触发方式、开始时间、耗时与结果计数。
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Section } from '../../components/page';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/states';
import { RunStatusBadge } from '../../components/status';
import { RelativeTime } from '../../components/text';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/table';
import { RunDuration, RunResultSummary } from '../runs/run-cells';
import { useRuns } from '../runs/run-queries';

/** 渲染最近运行分区；第一页每 15 秒刷新，含进行中运行时 5 秒（由查询自身决定）。
 * @returns 分区卡片。
 * @throws 不适用。
 */
export function RecentRunsSection() {
  const { t } = useTranslation(['dashboard', 'common']);
  const runs = useRuns({ page: 1, pageSize: 10 });
  const items = runs.data?.items;

  return (
    <Section
      title={t('recent.title')}
      flush
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link to="/runs">{t('common:actions.viewAll')}</Link>
        </Button>
      }
    >
      {runs.isError && items && (
        <p className="border-b border-border bg-warning/8 px-4 py-1.5 text-xs text-warning">
          {t('common:states.stale')}
        </p>
      )}
      {!items ? (
        runs.isError ? (
          <div className="p-3">
            <ErrorState
              error={runs.error}
              onRetry={() => void runs.refetch()}
              compact
            />
          </div>
        ) : (
          <div className="p-3">
            <TableSkeleton rows={5} columns={6} label={t('recent.loading')} />
          </div>
        )
      ) : items.length === 0 ? (
        <EmptyState
          compact
          title={t('recent.empty')}
          description={t('recent.emptyDescription')}
        />
      ) : (
        <Table bare>
          <THead>
            <tr>
              <TH>{t('recent.columns.job')}</TH>
              <TH>{t('recent.columns.status')}</TH>
              <TH>{t('recent.columns.type')}</TH>
              <TH>{t('recent.columns.trigger')}</TH>
              <TH>{t('recent.columns.started')}</TH>
              <TH className="text-right">{t('recent.columns.duration')}</TH>
              <TH>{t('recent.columns.result')}</TH>
            </tr>
          </THead>
          <TBody>
            {items.map((run) => (
              <TR key={run.id}>
                <TD className="max-w-64">
                  <Link
                    to={`/runs/${run.id}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {run.jobName}
                  </Link>
                </TD>
                <TD>
                  <RunStatusBadge
                    status={run.status}
                    stopReason={run.stopReason}
                  />
                </TD>
                <TD>
                  {run.dryRun ? (
                    <Badge>{t('common:dryRun')}</Badge>
                  ) : (
                    <span className="text-muted-foreground">
                      {t('common:realRun')}
                    </span>
                  )}
                </TD>
                <TD className="text-muted-foreground">
                  {t(`common:trigger.${run.trigger}`)}
                </TD>
                <TD className="whitespace-nowrap text-muted-foreground">
                  {run.startedAt ? (
                    <RelativeTime iso={run.startedAt} />
                  ) : (
                    t('recent.notStarted')
                  )}
                </TD>
                <TD className="text-right whitespace-nowrap">
                  <RunDuration run={run} />
                </TD>
                <TD>
                  <RunResultSummary run={run} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Section>
  );
}
