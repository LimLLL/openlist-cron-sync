// 运行详情的“扫描问题”标签：独立分页的问题表，错误码本地化并保留原文，受保护子树单独标出。
import { useTranslation } from 'react-i18next';
import {
  EmptyState,
  ErrorState,
  StaleNotice,
  TableSkeleton,
} from '../../components/states';
import { PathText, RelativeTime } from '../../components/text';
import { Badge } from '../../components/ui/badge';
import { Pagination } from '../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/table';
import { useErrorText } from '../../i18n/error-text';
import { usePageParams } from '../../lib/hooks';
import { isActiveRun, useRunIssues } from './run-queries';
import type { RunDetail } from './run-contract';

/** 从运行快照中读取实例名；快照没有时回退为短 ID。
 * @param run 运行详情。
 * @param instanceId 实例 ID。
 * @returns 实例名。
 * @throws 不适用。
 */
function snapshotInstanceName(run: RunDetail, instanceId: string): string {
  const name = run.config.instances[instanceId]?.name;
  return typeof name === 'string' && name ? name : instanceId.slice(0, 8);
}

/** 渲染运行的扫描问题表。
 * @param props run 运行详情。
 * @returns 问题标签内容。
 * @throws 不适用；请求错误在标签内显示。
 */
export function RunIssuesTab({ run }: { run: RunDetail }) {
  const { t } = useTranslation(['runs', 'common']);
  const errorText = useErrorText();
  const { page, pageSize, setPage } = usePageParams(
    { page: 1, pageSize: 50 },
    'issues',
  );
  const issues = useRunIssues(
    run.id,
    { page, pageSize },
    isActiveRun(run.status),
  );
  const data = issues.data;

  if (!data)
    return issues.isError ? (
      <ErrorState error={issues.error} onRetry={() => void issues.refetch()} />
    ) : (
      <TableSkeleton columns={5} label={t('issues.loading')} />
    );

  if (data.items.length === 0)
    return (
      <>
        <StaleNotice show={issues.isRefetchError} />
        <EmptyState
          title={t('issues.emptyTitle')}
          description={t('issues.emptyDescription')}
        />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data.total}
          onPageChange={(next) => setPage({ page: next })}
          className="mt-3"
        />
      </>
    );

  return (
    <>
      {issues.isRefetchError && (
        <p role="status" className="mb-2 text-xs text-warning">
          {t('common:states.stale')}
        </p>
      )}
      <Table aria-label={t('issues.label')}>
        <THead>
          <tr>
            <TH className="w-44">{t('issues.columns.code')}</TH>
            <TH className="w-40">{t('issues.columns.endpoint')}</TH>
            <TH>{t('issues.columns.path')}</TH>
            <TH>{t('issues.columns.message')}</TH>
            <TH className="w-28">{t('issues.columns.time')}</TH>
          </tr>
        </THead>
        <TBody>
          {data.items.map((issue) => {
            const message = errorText(issue.code, issue.message);
            return (
              <TR key={issue.id}>
                <TD>
                  <Badge tone={issue.protectSubtree ? 'danger' : 'warning'}>
                    <span className="font-mono" translate="no">
                      {issue.code}
                    </span>
                  </Badge>
                </TD>
                <TD className="text-[13px] whitespace-nowrap">
                  {t(`issues.role.${issue.endpointRole}`)}
                  <span className="ml-1.5 text-muted-foreground">
                    {snapshotInstanceName(run, issue.instanceId)}
                  </span>
                </TD>
                <TD className="max-w-80">
                  <PathText path={issue.path} />
                </TD>
                <TD className="text-[13px]">
                  <p>{message}</p>
                  {message !== issue.message &&
                    issue.message !== issue.code && (
                      <p className="text-xs break-words text-muted-foreground">
                        {issue.message}
                      </p>
                    )}
                  {issue.protectSubtree && (
                    <p className="text-xs text-danger">
                      {t('issues.protected')}
                    </p>
                  )}
                </TD>
                <TD>
                  <RelativeTime iso={issue.createdAt} />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={data.total}
        onPageChange={(next) => setPage({ page: next })}
        className="mt-3"
      />
    </>
  );
}
