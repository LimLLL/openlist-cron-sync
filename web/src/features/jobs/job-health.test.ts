// 验证真实终态关注规则；手动取消、归档和定时诊断不混成运行失败。
import { describe, expect, it } from 'vitest';
import { mixedJobFixture } from './job-test-fixture';
import { jobAttention, runAttention } from './job-health';
import type { JobListItem, TerminalRealRunSummary } from './job-contract';

const run: TerminalRealRunSummary = {
  id: 'run',
  status: 'failed',
  createdAt: '2026-01-01T00:00:00Z',
  startedAt: null,
  endedAt: '2026-01-01T00:00:01Z',
  stopReason: null,
  error: null,
};

describe('job attention', () => {
  it('distinguishes explicit timeout from deliberate or unknown cancellation', () => {
    expect(runAttention(null)).toBeNull();
    expect(runAttention({ ...run, status: 'succeeded' })).toBeNull();
    expect(
      runAttention({ ...run, status: 'cancelled', stopReason: 'USER_CANCEL' }),
    ).toBeNull();
    expect(
      runAttention({ ...run, status: 'cancelled', stopReason: null }),
    ).toBeNull();
    expect(
      runAttention({ ...run, status: 'cancelled', stopReason: 'RUN_TIMEOUT' }),
    ).toBe('timeout');
    for (const status of ['failed', 'partial', 'interrupted'] as const)
      expect(runAttention({ ...run, status })).toBe(status);
  });

  it('retains failure on a disabled job and separates schedule errors, excluding archived jobs', () => {
    const job: JobListItem = {
      ...mixedJobFixture(),
      enabled: false,
      archivedAt: null,
      latestTerminalRealRun: run,
      nextFireAt: null,
      scheduleError: { code: 'INVALID_CRON', message: 'Invalid cron' },
    };
    expect(jobAttention(job)).toEqual(['failed', 'scheduleError']);
    expect(jobAttention({ ...job, archivedAt: run.endedAt })).toEqual([]);
  });
});
