// 运行生命周期横条：已接受 → 开始扫描 → 扫描完成 → 执行 → 结束；只显示后端记录的时间点，取消/恢复/排队作为补充说明，从不推算进度或剩余时间。
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { LineSkeleton } from '../../components/skeleton';
import { RelativeTime } from '../../components/text';
import { formatTime, formatTimeFull } from '../../lib/format';
import { cn } from '../../lib/utils';
import { isActiveRun } from './run-queries';
import { hasPlannedWork, runCounts } from './run-format';
import type { RunDetail } from './run-contract';

/** 节点状态：已完成、进行中、未到达、已跳过。 */
type StepState = 'done' | 'current' | 'pending' | 'skipped';

/** 生命周期节点。 */
interface Step {
  /** 节点标签。 */
  label: string;
  /** 节点状态。 */
  state: StepState;
  /** 记录的时间；执行节点没有独立时间戳。 */
  time?: string | null;
  /** 没有时间时显示的说明。 */
  note?: string;
}

const DOT: Record<StepState, string> = {
  done: 'bg-foreground',
  current: 'bg-info motion-safe:animate-pulse',
  pending: 'border border-input bg-transparent',
  skipped: 'bg-surface-3',
};

/** 计算五个节点的状态与时间。
 * @param run 运行详情。
 * @param t runs 命名空间翻译函数。
 * @returns 节点数组。
 * @throws 不适用。
 */
function buildSteps(run: RunDetail, t: TFunction<['runs', 'common']>): Step[] {
  const active = isActiveRun(run.status);
  const terminal = !active;
  const counts = runCounts(run.stats);
  // 失败与结果未知只在实际尝试写入后记录（依赖失败记为跳过），同样证明进入过执行。
  const executionRecorded =
    counts.created > 0 ||
    counts.replaced > 0 ||
    counts.deleted > 0 ||
    counts.failed > 0 ||
    counts.unknown > 0 ||
    counts.transferred > 0 ||
    (run.stats.downloadedBytes ?? 0) > 0;
  const scanStarted: Step = run.startedAt
    ? {
        label: t('detail.lifecycle.scanStarted'),
        state: 'done',
        time: run.startedAt,
      }
    : {
        label: t('detail.lifecycle.scanStarted'),
        state: terminal ? 'skipped' : 'pending',
        note: terminal ? t('detail.lifecycle.notStarted') : undefined,
      };
  const scanCompleted: Step = run.scanCompletedAt
    ? {
        label: t('detail.lifecycle.scanCompleted'),
        state: 'done',
        time: run.scanCompletedAt,
      }
    : {
        label: t('detail.lifecycle.scanCompleted'),
        state:
          run.status === 'scanning'
            ? 'current'
            : terminal
              ? 'skipped'
              : 'pending',
        note:
          run.status === 'scanning'
            ? t('common:runStatus.scanning')
            : terminal
              ? t('detail.lifecycle.notReached')
              : undefined,
      };

  // 执行没有独立开始时间（扫描完成后还有安全检查），只显示状态。
  let execute: Step;
  if (run.dryRun)
    execute = {
      label: t('common:runStatus.executing'),
      state: 'skipped',
      note: t('detail.lifecycle.dryRunSkip'),
    };
  else if (run.status === 'planned')
    execute = {
      label: t('common:runStatus.executing'),
      state: 'pending',
      note: t('common:runStatus.planned'),
    };
  else if (run.status === 'executing')
    execute = {
      label: t('common:runStatus.executing'),
      state: 'current',
      note: t('detail.lifecycle.executing'),
    };
  else if (run.status === 'cancelling' || run.status === 'recovering')
    execute = {
      label: t('common:runStatus.executing'),
      state: run.scanCompletedAt ? 'current' : 'pending',
      note: t(`detail.lifecycle.${run.status}`),
    };
  else if (terminal && run.scanCompletedAt && !hasPlannedWork(run.stats))
    execute = {
      label: t('common:runStatus.executing'),
      state: 'skipped',
      note: t('detail.lifecycle.noWork'),
    };
  else if (terminal && run.scanCompletedAt)
    execute = {
      label: t('common:runStatus.executing'),
      state: executionRecorded ? 'done' : 'pending',
      // 扫描完成不证明进入过执行；删除保护可能使整个计划在执行前结束。
      note: executionRecorded
        ? t('detail.lifecycle.executionRecorded')
        : t('detail.lifecycle.executionUnknown'),
    };
  else
    execute = {
      label: t('common:runStatus.executing'),
      state: terminal ? 'skipped' : 'pending',
      note: terminal ? t('detail.lifecycle.notReached') : undefined,
    };

  return [
    {
      label: t('detail.lifecycle.accepted'),
      state: run.status === 'queued' ? 'current' : 'done',
      time: run.createdAt,
    },
    scanStarted,
    scanCompleted,
    execute,
    run.endedAt
      ? { label: t('detail.lifecycle.ended'), state: 'done', time: run.endedAt }
      : { label: t('detail.lifecycle.ended'), state: 'pending' },
  ];
}

/** 渲染单个节点的时间：短格式 + 相对时间，悬停显示完整时间。
 * @param props iso 时间。
 * @returns 时间文本。
 * @throws 不适用。
 */
function StepTime({ iso }: { iso: string }) {
  return (
    <span title={formatTimeFull(iso)} className="tabular-nums">
      {formatTime(iso)}
      <span className="ml-1.5 text-xs text-muted-foreground">
        <RelativeTime iso={iso} />
      </span>
    </span>
  );
}

/** 渲染运行生命周期横条及补充说明。
 * @param props run 运行详情。
 * @returns 生命周期区块。
 * @throws 不适用。
 */
export function RunLifecycle({ run }: { run: RunDetail }) {
  const { t } = useTranslation(['runs', 'common']);
  const steps = buildSteps(run, t);
  const notes: ReactNode[] = [];
  if (run.status === 'queued')
    notes.push(
      t('detail.lifecycle.queued', {
        time: formatTime(run.createdAt),
        deadline: formatTime(run.queueDeadlineAt),
      }),
    );
  if (run.cancelRequestedAt)
    notes.push(
      t('detail.lifecycle.cancelRequested', {
        time: formatTime(run.cancelRequestedAt),
      }),
    );
  if (run.status === 'recovering' && run.recoveryDeadlineAt)
    notes.push(
      t('detail.lifecycle.recoveryDeadline', {
        deadline: formatTime(run.recoveryDeadlineAt),
      }),
    );
  if (run.stopReason)
    notes.push(
      t('detail.lifecycle.stopReason', {
        reason:
          run.stopReason === 'USER_CANCEL' ||
          run.stopReason === 'RUN_TIMEOUT' ||
          run.stopReason === 'PROCESS_RESTART'
            ? t(`common:stopReason.${run.stopReason}`)
            : run.stopReason,
      }),
    );
  if (isActiveRun(run.status) && run.deadlineAt)
    notes.push(
      t('detail.lifecycle.deadline', { time: formatTime(run.deadlineAt) }),
    );

  return (
    <div className="mb-4">
      <ol
        aria-label={t('detail.lifecycle.label')}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5"
      >
        {steps.map((step, index) => (
          <li
            key={index}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className={cn(
              'min-w-0 bg-surface px-3 py-2',
              step.state === 'current' && 'bg-info/6',
            )}
          >
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  DOT[step.state],
                )}
              />
              <span className="truncate">{step.label}</span>
            </p>
            <p
              className={cn(
                'mt-0.5 truncate text-[13px]',
                (step.state === 'pending' || step.state === 'skipped') &&
                  'text-muted-foreground',
                step.state === 'current' && 'font-medium text-info',
              )}
            >
              {step.time ? <StepTime iso={step.time} /> : (step.note ?? '—')}
            </p>
          </li>
        ))}
      </ol>
      {notes.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 首次加载时的生命周期骨架：五个节点名称照常显示，时间占位。
 * @returns 与真实横条同布局的骨架。
 * @throws 不适用。
 */
export function RunLifecycleSkeleton() {
  const { t } = useTranslation(['runs', 'common']);
  const labels = [
    t('detail.lifecycle.accepted'),
    t('detail.lifecycle.scanStarted'),
    t('detail.lifecycle.scanCompleted'),
    t('common:runStatus.executing'),
    t('detail.lifecycle.ended'),
  ];
  return (
    <ol
      aria-label={t('detail.lifecycle.label')}
      className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5"
    >
      {labels.map((label, index) => (
        <li key={index} className="min-w-0 bg-surface px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn('size-1.5 shrink-0 rounded-full', DOT.pending)}
            />
            <span className="truncate">{label}</span>
          </p>
          <div className="mt-0.5">
            <LineSkeleton className={index % 2 ? 'w-16' : 'w-20'} />
          </div>
        </li>
      ))}
    </ol>
  );
}
