// 操作详情的记录部分：错误横幅、生命周期时间线、标识与传输事实规格表、处置结果。
import { CircleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ScrambleText } from '../../components/motion/scramble-text';
import { Badge } from '../../components/ui/badge';
import { SpecGrid } from '../../components/ui/spec-grid';
import type { SpecItem } from '../../components/ui/spec-grid';
import { Timeline } from '../../components/ui/timeline';
import type { TimelineItem } from '../../components/ui/timeline';
import { useErrorText } from '../../i18n/error-text';
import { formatBytes, formatTimeFull } from '../../lib/format';
import type { OperationView } from './operation-contract';

const NONE = '—';

/** 渲染操作错误：本地化说明为主，错误码与后端原文作为诊断信息保留。
 * @param props error 操作错误。
 * @returns 错误横幅。
 * @throws 不适用。
 */
export function OperationError({
  error,
}: {
  error: NonNullable<OperationView['error']>;
}) {
  const { t } = useTranslation('operations');
  const errorText = useErrorText();
  const message = errorText(error.code, error.message);
  return (
    <div
      role="alert"
      className="mb-10 flex gap-4 rounded-[1.5rem] border border-danger/25 bg-danger/[0.05] p-5 sm:p-6"
    >
      <CircleAlert
        size={20}
        className="mt-0.5 shrink-0 text-danger"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="eyebrow text-danger">{t('detail.error')}</p>
        <p className="mt-2 text-[15px] leading-7">{message}</p>
        <p className="mt-2 font-mono text-[11.5px] break-all text-muted-foreground">
          {error.code}
          {message !== error.message && ` · ${error.message}`}
        </p>
      </div>
    </div>
  );
}

/** 渲染生命周期时间线；隔离相关节点只在出现过未知结果时显示。
 * @param props op 操作视图。
 * @returns 时间线。
 * @throws 不适用。
 */
export function OperationTimeline({ op }: { op: OperationView }) {
  const { t } = useTranslation('operations');
  const time = (iso: string | null) => (iso ? formatTimeFull(iso) : null);
  const items: TimelineItem[] = [
    { label: t('detail.lifecycle.created'), time: time(op.createdAt) },
    { label: t('detail.lifecycle.submitted'), time: time(op.submittedAt) },
    {
      label: t('detail.lifecycle.ended'),
      time: time(op.endedAt),
      tone: op.status === 'failed' ? 'danger' : undefined,
    },
  ];
  if (op.unknownSince) {
    items.push(
      {
        label: t('detail.lifecycle.unknownSince'),
        time: time(op.unknownSince),
        tone: 'danger',
      },
      {
        label: t('detail.lifecycle.unknownUntil'),
        time: time(op.unknownUntil),
        tone: 'warning',
      },
    );
  }
  if (op.quarantineReleasedAt)
    items.push({
      label: t('detail.lifecycle.quarantineReleased'),
      time: time(op.quarantineReleasedAt),
      tone: 'warning',
      note: op.quarantineReleaseReason
        ? t('detail.lifecycle.releaseReason', {
            reason: op.quarantineReleaseReason,
          })
        : undefined,
    });
  if (op.reobservedAt)
    items.push({
      label: t('detail.lifecycle.reobserved'),
      time: time(op.reobservedAt),
    });
  if (op.resolution)
    items.push({
      label: t('detail.lifecycle.resolved', {
        kind: t(`detail.resolution.kind.${op.resolution.kind}`),
      }),
      time: time(op.resolution.resolvedAt),
      tone: op.resolution.kind === 'abandoned' ? 'warning' : 'success',
    });
  return <Timeline items={items} />;
}

/** 渲染指向另一实体的等宽短链接。
 * @param props to 目标路由；id 完整 ID。
 * @returns 链接。
 * @throws 不适用。
 */
function IdLink({ to, id }: { to: string; id: string }) {
  return (
    <Link to={to} className="text-accent underline-offset-4 hover:underline">
      <ScrambleText text={id.slice(0, 8)} />
    </Link>
  );
}

/** 渲染标识与传输事实；没有的字段不显示，避免一屏占位符。
 * @param props op 操作视图。
 * @returns 规格表。
 * @throws 不适用。
 */
export function OperationFacts({ op }: { op: OperationView }) {
  const { t } = useTranslation(['operations', 'common']);
  const items: SpecItem[] = [
    {
      label: t('detail.operationId'),
      value: <ScrambleText text={op.id} playOnMount />,
      mono: true,
      wide: true,
    },
    {
      label: t('detail.record.run'),
      value: <IdLink to={`/runs/${op.runId}`} id={op.runId} />,
      mono: true,
    },
    { label: t('detail.record.sequence'), value: `#${op.seq}`, mono: true },
    {
      label: t('detail.record.reason'),
      value: t(`common:operationReason.${op.reason}`),
    },
    {
      label: t('detail.record.expectedSource'),
      value:
        op.expectedSourceSize === null
          ? NONE
          : formatBytes(op.expectedSourceSize),
      mono: true,
    },
    {
      label: t('detail.record.expectedTarget'),
      value:
        op.expectedTargetSize === null
          ? NONE
          : formatBytes(op.expectedTargetSize),
      mono: true,
    },
    {
      label: t('detail.record.affectedBytes'),
      value: formatBytes(op.affectedBytes),
      mono: true,
    },
  ];
  // 创建目录不显示统计带，尝试次数改放在记录里。
  if (op.action === 'mkdir')
    items.push({
      label: t('detail.stats.attempt'),
      value: String(op.attemptNo),
      mono: true,
    });
  if (op.sourceInstanceId)
    items.push({
      label: t('detail.record.sourceInstance'),
      value: op.sourceInstanceId.slice(0, 8),
      mono: true,
    });
  items.push({
    label: t('detail.record.targetInstance'),
    value: op.targetInstanceId.slice(0, 8),
    mono: true,
  });
  if (op.retryOf)
    items.push({
      label: t('detail.record.retryOf'),
      value: <IdLink to={`/operations/${op.retryOf}`} id={op.retryOf} />,
      mono: true,
    });
  if (op.causedByOperationId)
    items.push({
      label: t('detail.record.causedBy'),
      value: (
        <IdLink
          to={`/operations/${op.causedByOperationId}`}
          id={op.causedByOperationId}
        />
      ),
      mono: true,
    });
  if (op.task)
    items.push({
      label: t('detail.record.remoteTask'),
      value:
        op.task.state === null
          ? op.task.id
          : `${op.task.id} · ${t('detail.record.taskState', { state: op.task.state })}`,
      mono: true,
      wide: true,
    });
  if (op.multipart)
    items.push(
      {
        label: t('detail.record.multipart'),
        value: op.multipart.uploadId,
        mono: true,
        wide: true,
      },
      {
        label: t('detail.record.multipartState'),
        value: op.multipart.state ?? NONE,
        mono: true,
      },
      {
        label: t('detail.record.chunk'),
        value: formatBytes(op.multipart.chunkSize),
        mono: true,
      },
      {
        label: t('detail.record.multipartAttempt'),
        value: op.multipart.attempt ?? NONE,
        mono: true,
      },
      {
        label: t('detail.record.streamCompleted'),
        value: formatTimeFull(op.multipart.sourceStreamCompletedAt),
        mono: true,
        wide: true,
      },
    );
  return <SpecGrid items={items} columns={3} />;
}

/** 渲染处置结果：类型、备注、时间与确认它的运行。
 * @param props resolution 处置结果。
 * @returns 处置信息。
 * @throws 不适用。
 */
export function ResolutionBlock({
  resolution,
}: {
  resolution: NonNullable<OperationView['resolution']>;
}) {
  const { t } = useTranslation('operations');
  const variant =
    resolution.kind === 'observed'
      ? 'success'
      : resolution.kind === 'superseded'
        ? 'info'
        : 'warning';
  return (
    <div>
      <Badge variant={variant}>
        {t(`detail.resolution.kind.${resolution.kind}`)}
      </Badge>
      {resolution.note && (
        <blockquote className="serif-accent mt-5 border-l border-accent/40 pl-5 text-xl leading-relaxed">
          {resolution.note}
        </blockquote>
      )}
      <SpecGrid
        className="mt-6"
        columns={2}
        items={[
          {
            label: t('detail.resolution.at'),
            value: formatTimeFull(resolution.resolvedAt),
            mono: true,
          },
          {
            label: t('detail.resolution.byRun'),
            value: resolution.runId ? (
              <IdLink to={`/runs/${resolution.runId}`} id={resolution.runId} />
            ) : (
              NONE
            ),
            mono: true,
          },
        ]}
      />
    </div>
  );
}
