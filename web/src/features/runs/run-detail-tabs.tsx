// 运行的操作与扫描问题：胶囊标签切换，各自使用独立的 URL 分页参数；活动运行期间持续刷新。
import { Link } from 'react-router';
import * as Tabs from '@radix-ui/react-tabs';
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import { Pagination } from '../../components/ui/pagination';
import { ErrorState, LoadingState } from '../../components/states';
import { formatBytes } from '../../lib/format';
import { usePageParams } from '../../lib/hooks';
import { useErrorText } from '../../i18n/error-text';
import { useRunOperations, useRunIssues } from './run-queries';
import type { RunStatus, IssueView } from './run-contract';
import type { OperationView } from '../operations/operation-contract';
import { statusBadgeProps } from './run-status';

const TRIGGER_CLASS =
  'group flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground';

/** 渲染操作与问题标签页。
 * @param props runId 运行 ID；issueCount 问题数；status 运行状态（决定是否轮询）；preferIssues 默认打开问题页。
 * @returns 标签页组件。
 * @throws 不适用。
 */
export function DetailTabs({
  runId,
  issueCount,
  status,
  preferIssues = false,
}: {
  runId: string;
  issueCount: number;
  status: RunStatus;
  preferIssues?: boolean;
}) {
  const { t } = useTranslation('runs');
  return (
    <Tabs.Root defaultValue={preferIssues ? 'issues' : 'operations'}>
      <Tabs.List
        aria-label={t('tabs.label')}
        className="mb-6 inline-flex items-center gap-0.5 rounded-full border border-hairline bg-white/[0.02] p-1"
      >
        <Tabs.Trigger value="operations" className={TRIGGER_CLASS}>
          {t('tabs.operations')}
        </Tabs.Trigger>
        <Tabs.Trigger value="issues" className={TRIGGER_CLASS}>
          {t('tabs.issues')}
          {issueCount > 0 && (
            <span className="rounded-full bg-signal/20 px-1.5 font-mono text-[10px] text-signal group-data-[state=active]:bg-accent-foreground/15 group-data-[state=active]:text-accent-foreground">
              {issueCount}
            </span>
          )}
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="operations" className="focus-visible:outline-none">
        <OperationsTab runId={runId} status={status} />
      </Tabs.Content>
      <Tabs.Content value="issues" className="focus-visible:outline-none">
        <IssuesTab runId={runId} status={status} />
      </Tabs.Content>
    </Tabs.Root>
  );
}

/** 标签页内的轻量空状态；共享 EmptyState 的大幅轨道装饰在分节里过重。
 * @param props title 标题；description 说明。
 * @returns 虚线框提示。
 * @throws 不适用。
 */
function TabEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-hairline px-6 py-10 text-center">
      <p className="serif-accent text-2xl">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

/** 渲染操作表格，序号与路径可进入操作详情。
 * @param props runId 运行 ID；status 运行状态。
 * @returns 操作列表。
 * @throws 不适用。
 */
function OperationsTab({
  runId,
  status,
}: {
  runId: string;
  status: RunStatus;
}) {
  const { page, pageSize, setPage } = usePageParams(
    { page: 1, pageSize: 25 },
    'operations',
  );
  const ops = useRunOperations(runId, { page, pageSize }, status);
  const { t } = useTranslation(['runs', 'common']);

  if (ops.isPending)
    return <LoadingState rows={5} label={t('operations.loading')} />;
  if (ops.isError)
    return <ErrorState error={ops.error} onRetry={() => void ops.refetch()} />;
  if (ops.data.items.length === 0)
    return (
      <>
        <TabEmpty
          title={t('operations.emptyTitle')}
          description={t('operations.emptyDescription')}
        />
        <Pagination
          className="mt-6"
          page={page}
          pageSize={pageSize}
          total={ops.data.total}
          onPageChange={(next) => setPage({ page: next })}
        />
      </>
    );

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-[13px]">
          <thead>
            <tr className="eyebrow border-b border-hairline">
              <th className="py-3 pr-4 font-medium">{t('operations.seq')}</th>
              <th className="py-3 pr-4 font-medium">
                {t('operations.action')}
              </th>
              <th className="py-3 pr-4 font-medium">
                {t('operations.status')}
              </th>
              <th className="py-3 pr-4 font-medium">
                {t('operations.targetPath')}
              </th>
              <th className="py-3 text-right font-medium">
                {t('operations.size')}
              </th>
            </tr>
          </thead>
          <tbody>
            {ops.data.items.map((op: OperationView) => {
              const badge = statusBadgeProps(op.status);
              return (
                <tr
                  key={op.id}
                  className="group border-b border-hairline transition-colors hover:bg-white/[0.02]"
                >
                  <td className="py-3.5 pr-4 font-mono text-muted-foreground">
                    <Link
                      to={`/operations/${op.id}`}
                      className="transition-colors group-hover:text-accent"
                    >
                      {String(op.seq).padStart(3, '0')}
                    </Link>
                  </td>
                  <td className="py-3.5 pr-4">
                    {t(`common:operationAction.${op.action}`)}
                    {/* 只有复制需要区分中转与服务端复制；建目录与删除的方式和动作同义。 */}
                    {op.action === 'create' && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t(`common:operationMethod.${op.method}`)}
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 pr-4">
                    <Badge variant={badge.variant} pulse={badge.pulse}>
                      {t(`common:operationStatus.${op.status}`)}
                    </Badge>
                  </td>
                  <td
                    className="max-w-[24rem] truncate py-3.5 pr-4 font-mono text-[12px] text-muted-foreground"
                    title={op.targetPath}
                  >
                    <Link
                      to={`/operations/${op.id}`}
                      className="transition-colors hover:text-foreground"
                    >
                      {op.targetPath}
                    </Link>
                  </td>
                  <td className="py-3.5 text-right font-mono text-[12px]">
                    {op.isDir ? '—' : formatBytes(op.expectedSourceSize)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination
        className="mt-6"
        page={ops.data.page}
        pageSize={ops.data.pageSize}
        total={ops.data.total}
        onPageChange={(next) => setPage({ page: next })}
      />
    </div>
  );
}

/** 渲染扫描问题列表；受保护子树以危险色标出。
 * @param props runId 运行 ID；status 运行状态。
 * @returns 问题列表。
 * @throws 不适用。
 */
function IssuesTab({ runId, status }: { runId: string; status: RunStatus }) {
  const { page, pageSize, setPage } = usePageParams(
    { page: 1, pageSize: 25 },
    'issues',
  );
  const issues = useRunIssues(runId, { page, pageSize }, status);
  const { t } = useTranslation('runs');
  const errorText = useErrorText();

  if (issues.isPending)
    return <LoadingState rows={4} label={t('issues.loading')} />;
  if (issues.isError)
    return (
      <ErrorState error={issues.error} onRetry={() => void issues.refetch()} />
    );
  if (issues.data.items.length === 0)
    return (
      <>
        <TabEmpty
          title={t('issues.emptyTitle')}
          description={t('issues.emptyDescription')}
        />
        <Pagination
          className="mt-6"
          page={page}
          pageSize={pageSize}
          total={issues.data.total}
          onPageChange={(next) => setPage({ page: next })}
        />
      </>
    );

  return (
    <div>
      <ul className="border-t border-hairline">
        {issues.data.items.map((issue: IssueView) => {
          const message = errorText(issue.code, issue.message);
          return (
            <li
              key={issue.id}
              className="grid gap-3 border-b border-hairline py-5 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]"
            >
              <div className="flex flex-wrap items-start gap-2">
                <Badge variant={issue.protectSubtree ? 'danger' : 'warning'}>
                  <span className="font-mono">{issue.code}</span>
                </Badge>
                <Badge plain>{t(`issues.role.${issue.endpointRole}`)}</Badge>
              </div>
              <div className="min-w-0">
                <p className="text-sm leading-6">{message}</p>
                {message !== issue.message && issue.message !== issue.code && (
                  <p className="mt-0.5 font-mono text-[11px] break-all text-muted-foreground/70">
                    {issue.message}
                  </p>
                )}
                <p
                  className="mt-1.5 truncate font-mono text-[11.5px] text-muted-foreground"
                  title={issue.path}
                >
                  {issue.path}
                </p>
                {issue.protectSubtree && (
                  <p
                    className="mt-2 flex items-center gap-1.5 text-xs text-danger"
                    title={t('issues.protectedHint')}
                  >
                    <ShieldAlert size={12} aria-hidden="true" />
                    {t('issues.protected')}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Pagination
        className="mt-6"
        page={issues.data.page}
        pageSize={issues.data.pageSize}
        total={issues.data.total}
        onPageChange={(next) => setPage({ page: next })}
      />
    </div>
  );
}
