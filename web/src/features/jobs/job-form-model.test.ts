// 验证 Job 表单请求语义，重点覆盖 PATCH 的空阈值和数值边界。
import { describe, expect, it } from 'vitest';
import { buildJobInput, emptyTarget } from './job-form-model';
import type { JobFormValues } from './job-form-model';

/** 创建合法的独立表单夹具。
 * @returns 可修改的测试输入。
 * @throws 不适用。
 */
function fixture(): JobFormValues {
  return {
    name: 'Sync',
    createMode: 'relay',
    sourceInstanceId: '11111111-1111-4111-8111-111111111111',
    sourcePath: '/source',
    sourcePassword: '',
    sourceRefresh: false,
    targets: [
      {
        ...emptyTarget(),
        existingId: '33333333-3333-4333-8333-333333333333',
        instanceId: '22222222-2222-4222-8222-222222222222',
        path: '/target',
      },
    ],
    cron: '',
    timezone: 'UTC',
    includePatterns: '',
    excludePatterns: '',
    minSizeBytes: '',
    maxSizeBytes: '',
    allowEmptySource: false,
    syncEmptyDirs: false,
    relayBandwidthLimit: '0',
    timeoutSeconds: '86400',
  };
}

describe('job form payload', () => {
  it('clears a threshold with null while preserving target identity and passwords', () => {
    const values = fixture();
    values.targets[0].maxCount = '';
    const body = buildJobInput(values);
    expect(body.targets[0]).toMatchObject({
      id: values.targets[0].existingId,
      deleteLimits: { enabled: true, maxCount: null, maxPercent: 50 },
    });
    expect(body.targets[0]).not.toHaveProperty('password');
    expect(body.source).not.toHaveProperty('password');
  });
  it('does not truncate exponent notation or silently replace zero timeout', () => {
    const values = fixture();
    values.relayBandwidthLimit = '1e3';
    expect(buildJobInput(values).relayBandwidthLimit).toBe(1000);
    values.timeoutSeconds = '0';
    expect(() => buildJobInput(values)).toThrow('Timeout');
  });
  it('rejects unsafe integers and fractional limits', () => {
    const values = fixture();
    values.targets[0].maxCount = '9007199254740992';
    expect(() => buildJobInput(values)).toThrow('Delete count');
    values.targets[0].maxCount = '1.5';
    expect(() => buildJobInput(values)).toThrow('Delete count');
  });
  it('requires an effective threshold when deletion protection is enabled', () => {
    const values = fixture();
    values.targets[0].maxCount = '';
    values.targets[0].maxPercent = '';
    expect(() => buildJobInput(values)).toThrow('at least one threshold');
    values.targets[0].deleteLimitsEnabled = false;
    expect(buildJobInput(values).targets[0].deleteLimits).toEqual({
      enabled: false,
      maxCount: null,
      maxPercent: null,
    });
  });
  it('rejects cross-instance server copy and reversed file size limits', () => {
    const values = fixture();
    values.createMode = 'server_copy';
    expect(() => buildJobInput(values)).toThrow('source instance');
    values.createMode = 'relay';
    values.minSizeBytes = '20';
    values.maxSizeBytes = '10';
    expect(() => buildJobInput(values)).toThrow('Minimum size');
  });
  it('rejects invalid path, timezone and cron field count before submitting', () => {
    const values = fixture();
    values.sourcePath = '/../secret';
    expect(() => buildJobInput(values)).toThrow('absolute account path');
    values.sourcePath = '/source';
    values.timezone = 'Invalid/Zone';
    expect(() => buildJobInput(values)).toThrow('timezone');
    values.timezone = 'UTC';
    values.cron = '* * * * * *';
    expect(() => buildJobInput(values)).toThrow('five-field');
  });
  it('preserves spaces within glob patterns and rejects negation', () => {
    const values = fixture();
    values.includePatterns = ' report * \nphotos/**';
    expect(buildJobInput(values).filters.include).toEqual([
      ' report * ',
      'photos/**',
    ]);
    values.excludePatterns = '!private/**';
    expect(() => buildJobInput(values)).toThrow('negated');
  });
});
