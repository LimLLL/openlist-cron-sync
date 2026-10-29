// 单条文件操作的详情内容（操作详情页与运行详情侧边面板共用）：错误、源 → 方式 → 目标、记录字段、时间线与每次尝试；另含同布局的加载骨架。
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { KeyValue } from '../../components/page';
import type { Fact } from '../../components/page';
import {
  LineSkeleton,
  Skeleton,
  SkeletonRegion,
  skeletonFacts,
} from '../../components/skeleton';
import { OperationStatusBadge } from '../../components/status';
import { Endpoint, RelativeTime, ShortId } from '../../components/text';
import { useErrorText } from '../../i18n/error-text';
import { formatBytes, formatTimeFull } from '../../lib/format';
import type {
  AttemptView,
  OperationDetail,
  OperationView,
} from './operation-contract';

/** 取路径最后一段作为显示名；根路径返回自身。
 * @param path 绝对路径。
 * @returns 文件或目录名。
 * @throws 不适用。
 */
export function pathName(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const name = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return name || trimmed;
}

/** 渲染操作大小：目录显示“目录”，文件优先用预期源大小，删除用影响字节。
 * @param props operation 操作；directory 目录文案。
 * @returns 大小文本。
 * @throws 不适用。
 */
export function OperationSize({
  operation,
  directory,
}: {
  operation: Pick<
    OperationView,
    'isDir' | 'expectedSourceSize' | 'affectedBytes'
  >;
  directory: string;
}) {
  if (operation.isDir)
    return <span className="text-muted-foreground">{directory}</span>;
  if (operation.expectedSourceSize !== null)
    return <>{formatBytes(operation.expectedSourceSize)}</>;
  if (operation.affectedBytes > 0)
    return <>{formatBytes(operation.affectedBytes)}</>;
  return <span className="text-muted-foreground">—</span>;
}

/** 渲染带时区完整时间的单元，缺失时为占位符。
 * @param props iso 时间。
 * @returns 时间文本。
 * @throws 不适用。
 */
function FullTime({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular-nums">
      {formatTimeFull(iso)}
      <span className="ml-2 text-muted-foreground">
        <RelativeTime iso={iso} />
      </span>
    </span>
  );
}

/** 渲染分组标题。
 * @param props children 标题。
 * @returns h3。
 * @throws 不适用。
 */
function GroupTitle({ children }: { children: string }) {
  return (
    <h3 className="mb-2 text-xs font-medium text-muted-foreground">
      {children}
    </h3>
  );
}

/** 渲染错误说明块：本地化说明加原始错误码与摘要。
 * @param props error 结构化错误；title 标题。
 * @returns 错误块。
 * @throws 不适用。
 */
function ErrorBlock({
  error,
  title,
}: {
  error: { code: string; message: string };
  title: string;
}) {
  const errorText = useErrorText();
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger/25 bg-danger/6 p-3 text-[13px]"
    >
      <p className="font-medium text-danger">{title}</p>
      <p className="mt-1">{errorText(error.code, error.message)}</p>
      <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
        {error.code} · {error.message}
      </p>
    </div>
  );
}

/** 渲染一次尝试：编号、状态、时间与该次的远端事实；当前尝试的错误已在页首显示，这里只列更早尝试的错误。
 * @param props attempt 尝试；action 所属动作；current 是否为当前尝试。
 * @returns 一条尝试记录。
 * @throws 不适用。
 */
function AttemptItem({
  attempt,
  action,
  current,
}: {
  attempt: AttemptView;
  action: OperationView['action'];
  current: boolean;
}) {
  const { t } = useTranslation('operations');
  const errorText = useErrorText();
  const facts: Fact[] = [];
  // 退避中的尝试还没开始，只显示计划时间。
  if (attempt.status === 'pending' && attempt.nextAttemptAt)
    facts.push({
      label: t('detail.nextAttempt'),
      value: <FullTime iso={attempt.nextAttemptAt} />,
    });
  else
    facts.push(
      {
        label: t('detail.submitted'),
        value: <FullTime iso={attempt.submittedAt} />,
      },
      { label: t('detail.ended'), value: <FullTime iso={attempt.endedAt} /> },
    );
  // 源准备发生在目标提交之前；即使没有submittedAt，失败尝试也可能已经下载了字节。
  if (action === 'create')
    facts.push(
      {
        label: t('detail.transferred'),
        value: formatBytes(attempt.bytesTransferred),
      },
      {
        label: t('detail.downloaded'),
        value: formatBytes(attempt.bytesDownloaded),
      },
    );
  if (attempt.task)
    facts.push({
      label: t('detail.remoteTask'),
      value: (
        <span className="font-mono text-xs">
          {attempt.task.id}
          {attempt.task.state !== null && (
            <span className="ml-2 font-sans text-muted-foreground">
              {t('detail.taskState', { state: attempt.task.state })}
            </span>
          )}
          {attempt.remoteCleanupPending && (
            <span className="ml-2 font-sans text-warning">
              {t('detail.cleanupPending')}
            </span>
          )}
        </span>
      ),
    });
  if (attempt.multipart)
    facts.push(
      {
        label: t('detail.multipart'),
        value: (
          <span className="font-mono text-xs break-all">
            {attempt.multipart.uploadId}
          </span>
        ),
      },
      {
        label: t('detail.multipartState'),
        value: attempt.multipart.state ?? '—',
      },
      {
        label: t('detail.chunk'),
        value: formatBytes(attempt.multipart.chunkSize),
      },
      {
        label: t('detail.multipartAttempt'),
        value: attempt.multipart.attempt ?? '—',
      },
      {
        label: t('detail.streamCompleted'),
        value: <FullTime iso={attempt.multipart.sourceStreamCompletedAt} />,
      },
    );
  if (attempt.unknownSince)
    facts.push({
      label: t('detail.unknownSince'),
      value: <FullTime iso={attempt.unknownSince} />,
    });
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center gap-2 text-[13px]">
        <span className="font-medium tabular-nums">
          {t('detail.attemptNo', { number: attempt.attemptNo })}
        </span>
        <OperationStatusBadge status={attempt.status} />
      </div>
      {!current && attempt.error && (
        <p className="mb-2 text-[13px]">
          {errorText(attempt.error.code, attempt.error.message)}
          <span className="ml-2 font-mono text-[11px] break-all text-muted-foreground">
            {attempt.error.code} · {attempt.error.message}
          </span>
        </p>
      )}
      <KeyValue items={facts} />
    </li>
  );
}

/** 渲染操作详情内容。
 * @param props operation 操作详情（含全部尝试）。
 * @returns 详情块。
 * @throws 不适用。
 */
export function OperationDetails({
  operation,
}: {
  operation: OperationDetail;
}) {
  const { t } = useTranslation(['operations', 'common']);
  const bytes = (value: number | null) =>
    value === null ? '—' : formatBytes(value);

  const record: Fact[] = [
    {
      label: t('detail.run'),
      value: (
        <Link to={`/runs/${operation.runId}`} className="hover:underline">
          <ShortId id={operation.runId} />
        </Link>
      ),
    },
    { label: t('detail.sequence'), value: operation.seq },
    {
      label: t('detail.reason'),
      value: t(`common:operationReason.${operation.reason}`),
    },
    { label: t('detail.attempt'), value: operation.attemptCount },
  ];
  if (!operation.isDir)
    record.push(
      {
        label: t('detail.expectedSource'),
        value: bytes(operation.expectedSourceSize),
      },
      {
        label: t('detail.expectedTarget'),
        value: bytes(operation.expectedTargetSize),
      },
    );
  if (operation.action === 'delete')
    record.push(
      {
        label: t('detail.affectedFiles'),
        value: operation.affectedFileCount,
      },
      {
        label: t('detail.affectedBytes'),
        value: bytes(operation.affectedBytes),
      },
    );
  // 多次尝试时摘要字节是全部尝试之和，标签写明“累计”，每次的值见尝试记录。
  const total = operation.attemptCount > 1;
  if (operation.action === 'create')
    record.push(
      {
        label: t(total ? 'detail.transferredTotal' : 'detail.transferred'),
        value: bytes(operation.bytesTransferred),
      },
      {
        label: t(total ? 'detail.downloadedTotal' : 'detail.downloaded'),
        value: bytes(operation.bytesDownloaded),
      },
    );

  const lifecycle: Fact[] = [
    {
      label: t('detail.created'),
      value: <FullTime iso={operation.createdAt} />,
    },
    {
      label: t('detail.submitted'),
      value: <FullTime iso={operation.submittedAt} />,
    },
    { label: t('detail.ended'), value: <FullTime iso={operation.endedAt} /> },
  ];
  if (operation.unknownSince)
    lifecycle.push({
      label: t('detail.unknownSince'),
      value: <FullTime iso={operation.unknownSince} />,
    });

  return (
    <div className="space-y-5">
      {operation.error && (
        <ErrorBlock error={operation.error} title={t('detail.errorTitle')} />
      )}

      <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
        <div className="min-w-0">
          <p className="mb-1 text-xs text-muted-foreground">
            {t('detail.source')}
          </p>
          {operation.sourcePath ? (
            <Endpoint
              instance={operation.sourceInstanceName ?? '—'}
              path={operation.sourcePath}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('detail.noSource')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowRight size={14} aria-hidden="true" />
          {t(`common:operationMethod.${operation.method}`)}
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-xs text-muted-foreground">
            {t('detail.target')}
            {operation.isDir && ` · ${t('detail.directory')}`}
          </p>
          <Endpoint
            instance={operation.targetInstanceName}
            path={operation.targetPath}
          />
        </div>
      </div>

      <div>
        <GroupTitle>{t('detail.record')}</GroupTitle>
        <KeyValue items={record} />
      </div>
      <div>
        <GroupTitle>{t('detail.lifecycle')}</GroupTitle>
        <KeyValue items={lifecycle} />
      </div>
      <div>
        <GroupTitle>{t('detail.attempts')}</GroupTitle>
        <ol className="space-y-2">
          {operation.attempts.map((attempt) => (
            <AttemptItem
              key={attempt.id}
              attempt={attempt}
              action={operation.action}
              current={attempt.attemptNo === operation.attemptCount}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

/** 首次加载时的操作详情骨架：源/目标与分组标题、字段名照常显示，值占位；详情页与侧边面板共用。
 * @param props label 读屏文字。
 * @returns 与真实详情同布局的骨架。
 * @throws 不适用。
 */
export function OperationDetailsSkeleton({ label }: { label?: string }) {
  const { t } = useTranslation('operations');
  return (
    <SkeletonRegion label={label} className="space-y-5">
      <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
        <div className="min-w-0">
          <p className="mb-1 text-xs text-muted-foreground">
            {t('detail.source')}
          </p>
          <LineSkeleton className="w-56" />
        </div>
        <Skeleton className="h-3 w-16" />
        <div className="min-w-0">
          <p className="mb-1 text-xs text-muted-foreground">
            {t('detail.target')}
          </p>
          <LineSkeleton className="w-48" />
        </div>
      </div>
      <div>
        <GroupTitle>{t('detail.record')}</GroupTitle>
        <KeyValue
          items={skeletonFacts([
            t('detail.run'),
            t('detail.sequence'),
            t('detail.reason'),
            t('detail.attempt'),
          ])}
        />
      </div>
      <div>
        <GroupTitle>{t('detail.lifecycle')}</GroupTitle>
        <KeyValue
          items={skeletonFacts([
            t('detail.created'),
            t('detail.submitted'),
            t('detail.ended'),
          ])}
        />
      </div>
      <div>
        <GroupTitle>{t('detail.attempts')}</GroupTitle>
        <div className="space-y-2 rounded-lg border border-border p-3">
          <LineSkeleton className="w-32" />
          <LineSkeleton className="w-64" />
        </div>
      </div>
    </SkeletonRegion>
  );
}
