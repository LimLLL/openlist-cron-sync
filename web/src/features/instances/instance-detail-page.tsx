// 实例详情：头部状态与操作、关键信息条、连接测试结果、最近错误/封锁提示，以及账号、传输、引用任务与记录分区。
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CircleAlert, MoreHorizontal } from 'lucide-react';
import {
  FactStrip,
  KeyValue,
  PageHeader,
  Section,
  useDocumentTitle,
} from '../../components/page';
import { RunStatusBadge } from '../../components/status';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  StaleNotice,
} from '../../components/states';
import { PathText, RelativeTime } from '../../components/text';
import { Button } from '../../components/ui/button';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '../../components/ui/menu';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/table';
import { useErrorText } from '../../i18n/error-text';
import { formatTimeFull } from '../../lib/format';
import { useJobCatalog } from '../jobs/job-queries';
import { InstanceBrowseDialog } from './instance-browse-dialog';
import {
  ArchiveInstanceDialog,
  instanceUsage,
  useAuthLabel,
} from './instance-actions';
import { InstanceHealthBadge, shortVersion } from './instance-health';
import { useInstance, useInstanceTest } from './instance-queries';
import { InstanceTestResult } from './instance-test-result';
import type { Instance } from './instance-contract';

/** 渲染实例详情页。
 * @returns 详情页面。
 * @throws 不适用；请求错误就地显示并可重试。
 */
export function InstanceDetailPage() {
  const { t } = useTranslation(['instances', 'common']);
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useInstance(id);
  const test = useInstanceTest();
  const { reset } = test;
  const [browsing, setBrowsing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  useDocumentTitle(query.data?.name, t('list.title'));

  // 同一页面切换到另一个实例时丢弃上一个实例的测试结果。
  useEffect(() => reset(), [id, reset]);

  const instance = query.data;
  if (!instance)
    return query.isError ? (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <LoadingState label={t('detail.loading')} rows={6} />
    );

  const blocked = instance.authState === 'auth_blocked';
  const ownTest = test.variables?.id === instance.id;
  const showResult = ownTest && (test.isPending || test.data !== undefined);

  return (
    <>
      <PageHeader
        back={{ to: '/instances', label: t('list.title') }}
        title={instance.name}
        badges={<InstanceHealthBadge instance={instance} />}
        description={<PathText path={instance.baseUrl} className="max-w-xl" />}
        actions={
          <>
            <Button
              onClick={() =>
                test.mutate({ id: instance.id, retryAuth: blocked })
              }
              disabled={test.isPending}
            >
              {test.isPending
                ? t('actions.testing')
                : blocked
                  ? t('actions.retryAuth')
                  : t('actions.test')}
            </Button>
            <Button onClick={() => setBrowsing(true)}>
              {t('actions.browse')}
            </Button>
            <Button asChild>
              <Link to={`/instances/${instance.id}/edit`}>
                {t('actions.edit')}
              </Link>
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button size="icon" aria-label={t('common:actions.more')}>
                  <MoreHorizontal size={15} aria-hidden="true" />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem asChild>
                  <Link to={`/operations?instanceId=${instance.id}`}>
                    {t('actions.operations')}
                  </Link>
                </MenuItem>
                <MenuSeparator />
                <MenuItem danger onSelect={() => setArchiving(true)}>
                  {t('actions.archive')}
                </MenuItem>
              </MenuContent>
            </Menu>
          </>
        }
      />

      <StaleNotice show={query.isRefetchError} />
      <InstanceFacts instance={instance} />

      {showResult && (
        <InstanceTestResult pending={test.isPending} result={test.data} />
      )}
      {ownTest && test.isError && (
        <div className="mb-4">
          <ErrorState error={test.error} />
        </div>
      )}
      <InstanceProblems instance={instance} hideLastError={showResult} />

      <div className="grid gap-4 lg:grid-cols-2">
        <AccountSection instance={instance} />
        <TransferSection instance={instance} />
        <JobsSection instanceId={instance.id} />
        <RecordSection instance={instance} />
      </div>

      <p className="mt-4 text-[13px]">
        <Link
          to={`/operations?instanceId=${instance.id}`}
          className="text-link hover:underline"
        >
          {t('detail.operationsLink')}
        </Link>
      </p>

      <InstanceBrowseDialog
        instanceId={instance.id}
        instanceName={instance.name}
        open={browsing}
        onOpenChange={setBrowsing}
      />
      <ArchiveInstanceDialog
        instance={archiving ? instance : null}
        onClose={() => setArchiving(false)}
        onArchived={() => navigate('/instances')}
      />
    </>
  );
}

/** 头部下方的关键信息条。
 * @param props instance 实例。
 * @returns 信息条。
 * @throws 不适用。
 */
function InstanceFacts({ instance }: { instance: Instance }) {
  const { t } = useTranslation('instances');
  const authLabel = useAuthLabel();
  const version = shortVersion(instance.openlistVersion);
  const multipart =
    instance.multipartEnabled === null
      ? 'unknown'
      : instance.multipartEnabled
        ? 'true'
        : 'false';
  return (
    <FactStrip
      facts={[
        {
          label: t('detail.facts.status'),
          value: <InstanceHealthBadge instance={instance} />,
        },
        { label: t('detail.facts.auth'), value: authLabel(instance) },
        {
          label: t('detail.facts.account'),
          value: instance.accountUsername ? (
            <span title={instance.accountUsername}>
              {instance.accountUsername}
              {instance.accountRole !== null && (
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {instance.accountRole === 2
                    ? t('role.admin', { role: instance.accountRole })
                    : t('role.user', { role: instance.accountRole })}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {t('detail.notVerified')}
            </span>
          ),
        },
        {
          label: t('detail.facts.version'),
          value: (
            <span title={instance.openlistVersion ?? undefined}>
              {version ?? t('detail.unknownVersion')}
            </span>
          ),
        },
        {
          label: t('detail.facts.multipart'),
          value: t(`detail.multipart.${multipart}`),
        },
        {
          label: t('detail.facts.tested'),
          value: instance.lastTestAt ? (
            <RelativeTime iso={instance.lastTestAt} />
          ) : (
            <span className="text-muted-foreground">
              {t('detail.neverTested')}
            </span>
          ),
        },
      ]}
    />
  );
}

/** 最近错误与封锁提示；刚测试过时隐藏旧错误，以测试结果为准。
 * @param props instance 实例；hideLastError 是否隐藏最近错误。
 * @returns 提示块或 null。
 * @throws 不适用。
 */
function InstanceProblems({
  instance,
  hideLastError,
}: {
  instance: Instance;
  hideLastError: boolean;
}) {
  const { t } = useTranslation('instances');
  const errorText = useErrorText();
  const showError = instance.lastError && !hideLastError;
  const showBlock =
    instance.authState === 'auth_blocked' &&
    (instance.authBlockedUntil || instance.authBlockReason);
  if (!showError && !showBlock) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex gap-2.5 rounded-lg border border-danger/25 bg-danger/6 p-3 text-[13px]"
    >
      <CircleAlert
        size={16}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-danger"
      />
      <div className="min-w-0 space-y-1">
        {showError && instance.lastError && (
          <p>
            <span className="mr-1.5 font-medium">{t('detail.lastError')}</span>
            {errorText(instance.lastError.code, instance.lastError.message)}
            <span className="ml-2 font-mono text-[11px] break-all text-muted-foreground">
              {instance.lastError.code} · {instance.lastError.message}
            </span>
          </p>
        )}
        {showBlock && instance.authBlockedUntil && (
          <p>
            {t('detail.blockedUntil', {
              time: formatTimeFull(instance.authBlockedUntil),
            })}
          </p>
        )}
        {showBlock && instance.authBlockReason && (
          <p className="text-muted-foreground">
            {t('detail.blockReason', {
              reason: errorText(
                instance.authBlockReason,
                instance.authBlockReason,
              ),
            })}
          </p>
        )}
      </div>
    </div>
  );
}

/** 账号分区：最近一次测试确认的 OpenList 身份。
 * @param props instance 实例。
 * @returns 分区卡片。
 * @throws 不适用。
 */
function AccountSection({ instance }: { instance: Instance }) {
  const { t } = useTranslation('instances');
  return (
    <Section title={t('detail.sections.account')}>
      {instance.accountUsername === null ? (
        <p className="text-[13px] text-muted-foreground">
          {t('detail.accountEmpty')}
        </p>
      ) : (
        <KeyValue
          items={[
            { label: t('detail.username'), value: instance.accountUsername },
            {
              label: t('detail.basePath'),
              value: instance.accountBasePath ? (
                <span translate="no" className="font-mono text-[12.5px]">
                  {instance.accountBasePath}
                </span>
              ) : (
                '—'
              ),
            },
            {
              label: t('detail.role'),
              value:
                instance.accountRole === null
                  ? '—'
                  : instance.accountRole === 2
                    ? t('role.admin', { role: instance.accountRole })
                    : t('role.user', { role: instance.accountRole }),
            },
            {
              label: t('detail.permissions'),
              value: (
                <span className="font-mono text-[12.5px] tabular-nums">
                  {instance.accountPermissions ?? '—'}
                </span>
              ),
            },
          ]}
        />
      )}
    </Section>
  );
}

/** 传输分区：下载方式与分片上传能力。
 * @param props instance 实例。
 * @returns 分区卡片。
 * @throws 不适用。
 */
function TransferSection({ instance }: { instance: Instance }) {
  const { t } = useTranslation('instances');
  const multipart =
    instance.multipartEnabled === null
      ? 'unknown'
      : instance.multipartEnabled
        ? 'true'
        : 'false';
  return (
    <Section title={t('detail.sections.transfer')}>
      <KeyValue
        items={[
          {
            label: t('detail.downloadMode'),
            value: (
              <>
                {t(`download.${instance.downloadMode}`)}
                <span className="ml-2 text-xs text-muted-foreground">
                  {t(`detail.downloadHint.${instance.downloadMode}`)}
                </span>
              </>
            ),
          },
          {
            label: t('detail.facts.multipart'),
            value: t(`detail.multipart.${multipart}`),
          },
        ]}
      />
    </Section>
  );
}

/** 使用此实例的任务列表，附上次正式运行结果。
 * @param props instanceId 实例 ID。
 * @returns 分区卡片。
 * @throws 不适用。
 */
function JobsSection({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation('instances');
  const jobs = useJobCatalog();
  const usage = useMemo(
    () => (jobs.data ? instanceUsage(jobs.data, instanceId) : []),
    [jobs.data, instanceId],
  );
  return (
    <Section
      title={t('detail.sections.jobs')}
      description={jobs.data ? String(usage.length) : undefined}
      flush
      className="lg:col-span-2"
    >
      <StaleNotice show={jobs.isRefetchError} />
      {jobs.isPending ? (
        <div className="p-4">
          <LoadingState rows={2} />
        </div>
      ) : jobs.isError && !jobs.data ? (
        <div className="p-4">
          <ErrorState
            error={jobs.error}
            onRetry={() => void jobs.refetch()}
            compact
          />
        </div>
      ) : usage.length === 0 ? (
        <EmptyState compact title={t('detail.jobsEmpty')} />
      ) : (
        <Table bare>
          <THead>
            <tr>
              <TH>{t('detail.jobColumns.name')}</TH>
              <TH>{t('detail.jobColumns.role')}</TH>
              <TH>{t('detail.jobColumns.lastRun')}</TH>
            </tr>
          </THead>
          <TBody>
            {usage.map(({ job, role }) => {
              const run = job.latestTerminalRealRun;
              return (
                <TR key={job.id}>
                  <TD className="max-w-64">
                    <Link
                      to={`/jobs/${job.id}`}
                      className="block truncate font-medium hover:underline"
                    >
                      {job.name}
                    </Link>
                  </TD>
                  <TD className="whitespace-nowrap">
                    {t(`detail.roles.${role}`)}
                  </TD>
                  <TD>
                    {run ? (
                      <Link
                        to={`/runs/${run.id}`}
                        className="inline-flex items-center gap-2 hover:underline"
                      >
                        <RunStatusBadge
                          status={run.status}
                          stopReason={run.stopReason}
                        />
                        <RelativeTime
                          iso={run.endedAt}
                          className="text-xs text-muted-foreground"
                        />
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t('detail.neverRun')}
                      </span>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </Section>
  );
}

/** 记录分区：创建、更新、测试与封锁时间。
 * @param props instance 实例。
 * @returns 分区卡片。
 * @throws 不适用。
 */
function RecordSection({ instance }: { instance: Instance }) {
  const { t } = useTranslation('instances');
  return (
    <Section title={t('detail.sections.record')} className="lg:col-span-2">
      <KeyValue
        className="sm:grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)_minmax(7rem,max-content)_minmax(0,1fr)]"
        items={[
          {
            label: t('detail.created'),
            value: formatTimeFull(instance.createdAt),
          },
          {
            label: t('detail.updated'),
            value: formatTimeFull(instance.updatedAt),
          },
          {
            label: t('detail.lastTested'),
            value: instance.lastTestAt
              ? formatTimeFull(instance.lastTestAt)
              : t('detail.neverTested'),
          },
          {
            label: t('detail.blockedUntilLabel'),
            value: instance.authBlockedUntil
              ? formatTimeFull(instance.authBlockedUntil)
              : '—',
          },
        ]}
      />
    </Section>
  );
}
