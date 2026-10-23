// 验证 Job 表单请求语义，重点覆盖 PATCH 的空阈值和数值边界。
import { describe, expect, it } from 'vitest';
import {
  applyBrowsedPath,
  buildJobInput,
  emptyTarget,
  targetsFromJob,
  targetCreateModeState,
} from './job-form-model';
import type { JobFormValues } from './job-form-model';
import { mixedJobFixture } from './job-test-fixture';

/** 创建合法的独立表单夹具。
 * @returns 可修改的测试输入。
 * @throws 不适用。
 */
function fixture(): JobFormValues {
  return {
    name: 'Sync',
    sourceInstanceId: '11111111-1111-4111-8111-111111111111',
    sourcePath: '/source',
    sourcePassword: '',
    sourceRefresh: false,
    sourceDownloadConcurrency: '2',
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
    retryCount: '',
    relayBandwidthLimit: '0',
    timeoutSeconds: '86400',
  };
}

describe('job form payload', () => {
  /** 目标默认、编辑回填及序列化均使用同一新形状。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('hydrates and serializes mixed Target modes without a Job-level field', () => {
    const values = fixture();
    values.targets = targetsFromJob(mixedJobFixture());
    expect(emptyTarget().createMode).toBe('relay');
    const body = buildJobInput(values);
    expect(body).not.toHaveProperty('createMode');
    expect(body.targets.map((target) => target.createMode)).toEqual([
      'server_copy',
      'relay',
    ]);
  });
  /** 派生错误随目标本身移动，源或目标改变时不静默修正创建方式。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('keeps invalid selections and recomputes errors after source edits, reorder and removal', () => {
    const job = mixedJobFixture();
    const targets = targetsFromJob(job);
    const other = targets[1].instanceId;
    expect(targetCreateModeState(other, targets[0])).toEqual({
      unavailable: true,
      invalid: true,
    });
    targets.reverse();
    expect(
      targets.map((target) => targetCreateModeState(other, target).invalid),
    ).toEqual([false, true]);
    targets.splice(0, 1);
    expect(targetCreateModeState(other, targets[0]).invalid).toBe(true);
    expect(targets[0].createMode).toBe('server_copy');
    expect(
      targetCreateModeState(job.source.instanceId, targets[0]).invalid,
    ).toBe(false);
    targets[0].instanceId = other;
    expect(
      targetCreateModeState(job.source.instanceId, targets[0]).invalid,
    ).toBe(true);
    expect(targetCreateModeState('', targets[0])).toEqual({
      unavailable: true,
      invalid: true,
    });
    targets[0].instanceId = '';
    expect(
      targetCreateModeState(job.source.instanceId, targets[0]).invalid,
    ).toBe(true);
  });
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
  it('serializes retry count as retries after failure', () => {
    const values = fixture();
    values.retryCount = '0';
    expect(buildJobInput(values).retryCount).toBe(0);
    values.retryCount = '';
    expect(buildJobInput(values).retryCount).toBeNull();
    values.retryCount = '10';
    expect(() => buildJobInput(values)).toThrow('Retries after failure');
  });
  it('round-trips transfer quotas and keeps zero as unlimited except for chunks', () => {
    const values = fixture();
    values.targets = targetsFromJob(mixedJobFixture());
    values.sourceDownloadConcurrency = '0';
    values.targets[1].concurrentFiles = '0';
    const body = buildJobInput(values);
    expect(body.sourceDownloadConcurrency).toBe(0);
    expect(
      body.targets.map(({ concurrentFiles, chunkConcurrency }) => ({
        concurrentFiles,
        chunkConcurrency,
      })),
    ).toEqual([
      { concurrentFiles: 4, chunkConcurrency: 2 },
      { concurrentFiles: 0, chunkConcurrency: 2 },
    ]);
    values.targets[1].chunkConcurrency = '0';
    expect(() => buildJobInput(values)).toThrow('Chunks per file');
    values.targets[1].chunkConcurrency = '9';
    expect(() => buildJobInput(values)).toThrow('Chunks per file');
  });
  it('writes a browsed path and password back to the chosen endpoint only', () => {
    const values = fixture();
    values.targets = [emptyTarget(), emptyTarget()];
    const source = applyBrowsedPath(values, 'source', '/media', 'secret');
    expect(source).toMatchObject({
      sourcePath: '/media',
      sourcePassword: 'secret',
    });
    expect(source.targets).toBe(values.targets);
    const target = applyBrowsedPath(values, 1, '/backup', '');
    expect(target.targets.map((item) => item.path)).toEqual(['/', '/backup']);
    expect(applyBrowsedPath(values, 5, '/gone', '')).toBe(values);
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
    values.targets[0].createMode = 'server_copy';
    expect(() => buildJobInput(values)).toThrow('source instance');
    values.targets[0].createMode = 'relay';
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
