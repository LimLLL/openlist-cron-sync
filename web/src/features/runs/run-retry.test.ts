// 验证重试运行的契约字段：来源、资格摘要按后端原样解析，未知原因被拒绝，界面把重试与普通手动运行区分开。
import { describe, expect, it } from 'vitest';
import { mixedRunFixture } from '../jobs/job-test-fixture';
import { parseRunDetail } from './run-contract';
import { triggerKind } from './run-format';

/** 注册重试契约验收。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('retry run contract', () => {
  /** 来源与资格字段原样保留；后端新增或拼错的原因码不能被当成可展示状态。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 解析或断言失败。
   */
  it('parses retry origin and eligibility, rejecting unknown reasons', () => {
    const run = {
      ...mixedRunFixture(),
      dryRun: false,
      retryOfRunId: 'parent',
      retrySourceExists: false,
      retryEligibility: {
        eligible: true,
        reason: null,
        candidateFiles: 9,
        candidateDirectories: 1,
        excludedItems: 2,
      },
    };
    const parsed = parseRunDetail(run);
    expect(parsed).toMatchObject({
      retryOfRunId: 'parent',
      retrySourceExists: false,
      retryEligibility: run.retryEligibility,
    });
    expect(triggerKind(parsed)).toBe('retry');
    expect(triggerKind({ ...parsed, retryOfRunId: null })).toBe('manual');
    expect(() =>
      parseRunDetail({
        ...run,
        retryEligibility: { ...run.retryEligibility, reason: 'SOURCE_CHANGED' },
      }),
    ).toThrow();
    expect(() =>
      parseRunDetail({ ...run, retrySourceExists: undefined }),
    ).toThrow();
  });
});
