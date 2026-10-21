// 任务详情页的最近运行：本地最小解析，只取列表需要的字段，不与运行模块的完整契约耦合。
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { ApiError, isRecord } from '../../lib/api-client';
import { parsePage } from '../../lib/parsers';
import type { Page } from '../../lib/parsers';

const RUN_STATUSES = [
  'queued',
  'scanning',
  'planned',
  'executing',
  'cancelling',
  'recovering',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
  'interrupted',
] as const;

/** 运行状态。 */
export type JobRunStatus = (typeof RUN_STATUSES)[number];

/** 仍在进行、需要轮询的状态。 */
const ACTIVE: ReadonlySet<string> = new Set([
  'queued',
  'scanning',
  'planned',
  'executing',
  'cancelling',
  'recovering',
]);

/** 任务详情中展示的运行摘要。 */
export interface JobRun {
  /** Run UUID。 */
  id: string;
  /** 状态。 */
  status: JobRunStatus;
  /** 是否预览运行。 */
  dryRun: boolean;
  /** 触发方式。 */
  trigger: 'manual' | 'cron';
  /** 创建时间。 */
  createdAt: string;
  /** 开始时间。 */
  startedAt: string | null;
  /** 结束时间。 */
  endedAt: string | null;
}

/** 读取可空字符串字段。
 * @param value 未信任值。
 * @returns 字符串或 null。
 * @throws ApiError 类型不符。
 */
function nullableString(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value;
  throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid run timestamp.');
}

/** 校验运行摘要。
 * @param value 未信任的运行 JSON。
 * @returns 运行摘要。
 * @throws ApiError 字段缺失或枚举非法。
 */
export function parseJobRun(value: unknown): JobRun {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.status !== 'string' ||
    !(RUN_STATUSES as readonly string[]).includes(value.status) ||
    typeof value.dryRun !== 'boolean' ||
    (value.trigger !== 'manual' && value.trigger !== 'cron') ||
    typeof value.createdAt !== 'string'
  )
    throw new ApiError(0, 'INVALID_RESPONSE', 'Invalid run.');
  return {
    id: value.id,
    status: value.status as JobRunStatus,
    dryRun: value.dryRun,
    trigger: value.trigger,
    createdAt: value.createdAt,
    startedAt: nullableString(value.startedAt),
    endedAt: nullableString(value.endedAt),
  };
}

/** 查询某个任务最近的运行；有进行中的运行时轮询。
 * @param jobId Job UUID。
 * @param pageSize 条数。
 * @returns 查询结果；键以 runs 开头，触发运行后会随 runs 一并失效。
 * @throws 不适用；错误通过 Query 状态返回。
 */
export function useJobRuns(jobId: string, pageSize = 5) {
  const { request } = useAuth();
  return useQuery({
    queryKey: ['runs', 'job', jobId, pageSize],
    queryFn: ({ signal }) =>
      request(`/runs?jobId=${jobId}&page=1&pageSize=${pageSize}` as `/${string}`, {
        signal,
        parse: (value): Page<JobRun> => parsePage(value, parseJobRun, 'runs'),
      }),
    refetchInterval: (query) =>
      query.state.data?.items.some((run) => ACTIVE.has(run.status)) ? 3000 : false,
  });
}

/** 运行状态对应的标签样式。
 * @param status 运行状态。
 * @returns Badge 变体与是否呼吸。
 * @throws 不适用。
 */
export function runBadge(status: JobRunStatus): {
  variant: 'success' | 'danger' | 'warning' | 'default' | 'active';
  pulse: boolean;
} {
  if (status === 'succeeded') return { variant: 'success', pulse: false };
  if (status === 'failed') return { variant: 'danger', pulse: false };
  if (status === 'partial') return { variant: 'warning', pulse: false };
  if (status === 'cancelled' || status === 'interrupted')
    return { variant: 'default', pulse: false };
  if (status === 'cancelling' || status === 'recovering')
    return { variant: 'warning', pulse: true };
  return { variant: 'active', pulse: true };
}
