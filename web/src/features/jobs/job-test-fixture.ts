// 前端契约与表单测试共用完整的混合 Target 配置，不进入生产界面。
import type { JobView } from './job-contract';
import type { RunDetail } from '../runs/run-contract';

/** 创建可独立修改的完整 Job 响应。
 * @param 不适用。
 * @returns 含同实例 copy 和跨实例 relay 的 Job。
 * @throws 不适用。
 */
export function mixedJobFixture(): JobView {
  const source = {
    instanceId: '11111111-1111-4111-8111-111111111111',
    path: '/source',
    hasPassword: false,
    refresh: false,
  };
  return {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Mixed',
    source,
    targets: [
      {
        ...source,
        id: '44444444-4444-4444-8444-444444444444',
        path: '/copy',
        position: 0,
        mode: 'incremental',
        createMode: 'server_copy',
        deleteLimits: { enabled: true, maxCount: 1000, maxPercent: 50 },
      },
      {
        ...source,
        id: '55555555-5555-4555-8555-555555555555',
        instanceId: '22222222-2222-4222-8222-222222222222',
        path: '/relay',
        position: 1,
        mode: 'mirror',
        createMode: 'relay',
        deleteLimits: { enabled: true, maxCount: 1000, maxPercent: 50 },
      },
    ],
    enabled: false,
    cron: null,
    timezone: 'UTC',
    filters: {
      include: [],
      exclude: [],
      minSizeBytes: null,
      maxSizeBytes: null,
    },
    allowEmptySource: false,
    syncEmptyDirs: false,
    retryCount: null,
    relayBandwidthLimit: 12,
    timeoutSeconds: 86400,
    notificationChannelIds: [],
    createdAt: '2026-10-21T00:00:00Z',
    updatedAt: '2026-10-21T00:00:00Z',
    archivedAt: null,
  };
}

/** 创建脱离当前配置的历史 Run 响应。
 * @param 不适用。
 * @returns 两份 Target 快照均为规范形状的 Run。
 * @throws 不适用。
 */
export function mixedRunFixture(): RunDetail {
  const job = mixedJobFixture();
  return {
    id: 'run',
    jobId: job.id,
    trigger: 'manual',
    scheduledAt: null,
    dryRun: true,
    confirmDeletes: false,
    status: 'succeeded',
    stats: {},
    stopReason: null,
    error: null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.createdAt,
    scanCompletedAt: job.createdAt,
    endedAt: job.updatedAt,
    deadlineAt: null,
    queueDeadlineAt: job.createdAt,
    cancelRequestedAt: null,
    recoveryDeadlineAt: null,
    config: { snapshotVersion: 1, job, instances: {}, settings: {} },
    targets: job.targets.map(
      /** 将历史目标复制为独立的 Run Target 公共值。
       * @param target 接受时的目标。
       * @returns 历史目标摘要。
       * @throws 不适用。
       */
      (target) => ({
        id: `run-${target.id}`,
        targetId: target.id,
        config: {
          target: structuredClone(target),
          instance: { name: target.path },
        },
        stats: {},
        sourceComplete: true,
        targetComplete: true,
        suspect: false,
        deleteBlocked: false,
        extrasBlocked: false,
        blockReasons: [],
        observedTargetFileCount: 0,
        plannedReplaceCount: 0,
        plannedExtraCount: 0,
        deleteBudgetCount: null,
      }),
    ),
    issueCount: 0,
  };
}
