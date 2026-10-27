// 验证历史响应只接受规范 Target 创建方式，并在中英文目标摘要中显示。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { parseJob, parseTarget } from '../jobs/job-contract';
import { mixedJobFixture, mixedRunFixture } from '../jobs/job-test-fixture';
import { parseRunDetail } from './run-contract';
import { targetLabel } from './run-format';
import { RunTargets } from './run-targets';

/** 注册历史创建方式契约验收。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('historical Target create modes', () => {
  /** Job 与 Run Target 两份快照都读取冻结间隔，零值不能被丢弃或替换为当前配置。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 解析或断言失败。
   */
  it('preserves scan intervals in both snapshot locations and requires their fields', () => {
    const run = mixedRunFixture();
    const parsed = parseRunDetail(run);
    expect(parsed.config.job.sourceScanIntervalSeconds).toBe(1);
    expect(
      parsed.config.job.targets.map((target) => target.scanIntervalSeconds),
    ).toEqual([0, 3]);
    expect(
      parsed.targets.map((target) => target.config.target.scanIntervalSeconds),
    ).toEqual([0, 3]);
    expect(() =>
      parseRunDetail({
        ...run,
        config: {
          ...run.config,
          job: { ...run.config.job, sourceScanIntervalSeconds: undefined },
        },
      }),
    ).toThrow('sourceScanIntervalSeconds');
    expect(() =>
      parseRunDetail({
        ...run,
        config: {
          ...run.config,
          job: {
            ...run.config.job,
            targets: run.config.job.targets.map((target) => ({
              ...target,
              scanIntervalSeconds: undefined,
            })),
          },
        },
      }),
    ).toThrow('scanIntervalSeconds');
    expect(() =>
      parseRunDetail({
        ...run,
        targets: run.targets.map((target) => ({
          ...target,
          config: {
            ...target.config,
            target: { ...target.config.target, scanIntervalSeconds: undefined },
          },
        })),
      }),
    ).toThrow('scanIntervalSeconds');
  });

  /** 缺失或非法值不能默认为 relay；Job 与 Run 两个副本都须完整。
   * @param mode 非法创建方式。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it.each([undefined, null, 'automatic'])(
    'rejects a missing or invalid mode: %s',
    (mode) => {
      const job = mixedJobFixture();
      expect(() =>
        parseTarget({ ...job.targets[0], createMode: mode }, 0),
      ).toThrow('createMode');
      expect(() =>
        parseJob({
          ...job,
          targets: [{ ...job.targets[0], createMode: mode }],
        }),
      ).toThrow('createMode');
      const run = mixedRunFixture();
      const target = run.targets[0];
      expect(() =>
        parseRunDetail({
          ...run,
          targets: [
            {
              ...target,
              config: {
                ...target.config,
                target: { ...target.config.target, createMode: mode },
              },
            },
          ],
        }),
      ).toThrow('createMode');
      expect(() =>
        parseRunDetail({
          ...run,
          config: {
            ...run.config,
            job: {
              ...job,
              targets: [{ ...job.targets[0], createMode: mode }],
            },
          },
        }),
      ).toThrow('createMode');
    },
  );
  /** 摘要读取 Run Target 快照；新 Job 选择不影响旧记录显示。
   * @param language 当前界面语言。
   * @returns 渲染验证完成。
   * @throws Error 断言失败。
   */
  it.each(['zh', 'en'])(
    'renders both historical modes in %s',
    async (language) => {
      await i18n.changeLanguage(language);
      const historical = parseRunDetail(mixedRunFixture());
      const current = mixedJobFixture();
      current.targets[0].createMode = 'relay';
      expect(targetLabel(historical.targets[0]).createMode).toBe('server_copy');
      expect(targetLabel(historical.targets[1]).createMode).toBe('relay');
      const markup = renderToStaticMarkup(
        createElement(RunTargets, { targets: historical.targets }),
      );
      expect(markup).toContain(i18n.t('common:operationMethod.server_copy'));
      expect(markup).toContain(i18n.t('common:operationMethod.relay'));
    },
  );
});
