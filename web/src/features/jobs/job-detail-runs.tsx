// 任务详情的“运行记录”标签：该任务的运行分页表（状态、类型、触发、开始、耗时、结果），分页参数带 runs 前缀。
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { Section } from '../../components/page';
import { TableSkeleton } from '../../components/skeleton';
import { EmptyState, ErrorState, StaleNotice } from '../../components/states';
import { RunStatusBadge } from '../../components/status';
import { RelativeTime, ShortId } from '../../components/text';
import { Badge } from '../../components/ui/badge';
import { Pagination } from '../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/table';
import { usePageParams } from '../../lib/hooks';
import { RunDuration, RunResultSummary } from '../runs/run-cells';
import { useRuns } from '../runs/run-queries';
import { triggerKind } from '../runs/run-format';

const PAGE_DEFAULTS = { page: 1, pageSize: 25 };

/** 运行记录表表头；加载中与加载后共用。
 * @returns 表头。
 * @throws 不适用。
 */
function JobRunsTableHead() {
  const { t } = useTranslation('jobs');
  return (
    <THead>
      <tr>
        <TH>{t('detail.runs.col.status')}</TH>
        <TH>{t('detail.runs.col.type')}</TH>
        <TH>{t('detail.runs.col.trigger')}</TH>
        <TH>{t('detail.runs.col.started')}</TH>
        <TH>{t('detail.runs.col.duration')}</TH>
        <TH>{t('detail.runs.col.result')}</TH>
        <TH className="text-right">{t('detail.runs.col.id')}</TH>
      </tr>
    </THead>
  );
}

/** 渲染任务的运行记录表。
 * @param props jobId 任务 ID。
 * @returns 运行记录分区。
 * @throws 不适用；请求错误在分区内显示。
 */
export function JobRunsTab({ jobId }: { jobId: string }) {
  const { t } = useTranslation(['jobs', 'common']);
  const { page, pageSize, setPage } = usePageParams(PAGE_DEFAULTS, 'runs');
  const runs = useRuns({ jobId, page, pageSize });
  const data = runs.data;

  return (
    <Section
      flush
      title={t('detail.tabs.runs')}
      actions={
        <Link
          to={`/runs?jobId=${jobId}`}
          className="inline-flex items-center gap-1 text-xs text-link hover:underline"
        >
          {t('detail.runs.viewInRuns')}
          <ExternalLink size={12} aria-hidden="true" />
        </Link>
      }
    >
      <StaleNotice show={runs.isRefetchError} />
      {!data && !runs.isError ? (
        <TableSkeleton
          bare
          rows={5}
          head={<JobRunsTableHead />}
          columns={[
            'badge',
            'badge',
            'text',
            'time',
            'text',
            'path',
            { kind: 'id', className: 'text-right' },
          ]}
        />
      ) : !data ? (
        <div className="p-3">
          <ErrorState
            error={runs.error!}
            onRetry={() => {
              void runs.refetch();
            }}
          />
        </div>
      ) : data.items.length === 0 ? (
        <>
          <EmptyState
            compact
            title={t('detail.runs.empty')}
            description={t('detail.runs.emptyDescription')}
          />
          {/* 越界页码下列表为空，仍提供翻页回到有效页。 */}
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPageChange={(next) => setPage({ page: next })}
            className="border-t border-border px-3 py-2"
          />
        </>
      ) : (
        <>
          <Table bare>
            <JobRunsTableHead />
            <TBody>
              {data.items.map((run) => (
                <TR key={run.id}>
                  <TD>
                    <Link to={`/runs/${run.id}`} className="inline-flex">
                      <RunStatusBadge
                        status={run.status}
                        stopReason={run.stopReason}
                      />
                    </Link>
                  </TD>
                  <TD>
                    {run.dryRun ? (
                      <Badge>{t('common:dryRun')}</Badge>
                    ) : (
                      <span className="text-[13px]">{t('common:realRun')}</span>
                    )}
                  </TD>
                  <TD className="text-[13px] text-muted-foreground">
                    {t(`common:trigger.${triggerKind(run)}`)}
                  </TD>
                  <TD className="text-[13px] whitespace-nowrap">
                    {run.startedAt ? (
                      <RelativeTime iso={run.startedAt} />
                    ) : (
                      <span className="text-muted-foreground">
                        {t('detail.runs.notStarted')}
                      </span>
                    )}
                  </TD>
                  <TD className="text-[13px] whitespace-nowrap">
                    <RunDuration run={run} />
                  </TD>
                  <TD className="text-[13px]">
                    <RunResultSummary run={run} />
                  </TD>
                  <TD className="text-right">
                    <Link to={`/runs/${run.id}`} className="hover:underline">
                      <ShortId id={run.id} />
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPageChange={(next) => setPage({ page: next })}
            className="border-t border-border px-3 py-2"
          />
        </>
      )}
    </Section>
  );
}
