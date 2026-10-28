// 单条文件操作的详情内容（操作详情页与运行详情侧边面板共用）：错误、源 → 方式 → 目标、记录字段与时间线；另含同布局的加载骨架。
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
import { Endpoint, RelativeTime, ShortId } from '../../components/text';
import { useErrorText } from '../../i18n/error-text';
import { formatBytes, formatTimeFull } from '../../lib/format';
import type { OperationView } from './operation-contract';

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

/** 渲染操作详情内容。
 * @param props operation 操作。
 * @returns 详情块。
 * @throws 不适用。
 */
export function OperationDetails({ operation }: { operation: OperationView }) {
  const { t } = useTranslation(['operations', 'common']);
  const errorText = useErrorText();
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
    { label: t('detail.attempt'), value: operation.attemptNo },
  ];
  if (operation.retryOf)
    record.push({
      label: t('detail.retryOf'),
      value: (
        <Link
          to={`/operations/${operation.retryOf}`}
          className="hover:underline"
        >
          <ShortId id={operation.retryOf} />
        </Link>
      ),
    });
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
  if (operation.action === 'create')
    record.push(
      {
        label: t('detail.transferred'),
        value: bytes(operation.bytesTransferred),
      },
      {
        label: t('detail.downloaded'),
        value: bytes(operation.bytesDownloaded),
      },
    );
  if (operation.task)
    record.push({
      label: t('detail.remoteTask'),
      value: (
        <span className="font-mono text-xs">
          {operation.task.id}
          {operation.task.state !== null && (
            <span className="ml-2 font-sans text-muted-foreground">
              {t('detail.taskState', { state: operation.task.state })}
            </span>
          )}
        </span>
      ),
    });
  if (operation.multipart)
    record.push(
      {
        label: t('detail.multipart'),
        value: (
          <span className="font-mono text-xs break-all">
            {operation.multipart.uploadId}
          </span>
        ),
      },
      {
        label: t('detail.multipartState'),
        value: operation.multipart.state ?? '—',
      },
      {
        label: t('detail.chunk'),
        value: formatBytes(operation.multipart.chunkSize),
      },
      {
        label: t('detail.multipartAttempt'),
        value: operation.multipart.attempt ?? '—',
      },
      {
        label: t('detail.streamCompleted'),
        value: <FullTime iso={operation.multipart.sourceStreamCompletedAt} />,
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
        <div
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/6 p-3 text-[13px]"
        >
          <p className="font-medium text-danger">{t('detail.errorTitle')}</p>
          <p className="mt-1">
            {errorText(operation.error.code, operation.error.message)}
          </p>
          <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
            {operation.error.code} · {operation.error.message}
          </p>
        </div>
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
    </SkeletonRegion>
  );
}
