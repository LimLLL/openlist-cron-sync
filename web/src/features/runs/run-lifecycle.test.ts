// 生命周期不把“已规划”或“扫描完成但被保护阻断”伪装成已经执行。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { mixedRunFixture } from '../jobs/job-test-fixture';
import { parseRunDetail } from './run-contract';
import { RunLifecycle } from './run-lifecycle';

describe('recorded run lifecycle', () => {
  it('keeps planned work pending execution', () => {
    const run = parseRunDetail(mixedRunFixture());
    run.status = 'planned';
    run.dryRun = false;
    run.endedAt = null;
    const markup = renderToStaticMarkup(createElement(RunLifecycle, { run }));
    expect(markup).toContain(i18n.t('common:runStatus.planned'));
  });

  it('does not claim execution when a terminal plan has no execution evidence', () => {
    const run = parseRunDetail(mixedRunFixture());
    run.status = 'partial';
    run.dryRun = false;
    run.scanCompletedAt = run.createdAt;
    run.stats = { plannedCreates: 3, skippedOperations: 3 };
    const markup = renderToStaticMarkup(createElement(RunLifecycle, { run }));
    expect(markup).toContain(i18n.t('runs:detail.lifecycle.executionUnknown'));
    expect(markup).not.toContain(
      i18n.t('runs:detail.lifecycle.executionRecorded'),
    );
  });

  it('treats failed writes as execution evidence', () => {
    const run = parseRunDetail(mixedRunFixture());
    run.status = 'failed';
    run.dryRun = false;
    run.scanCompletedAt = run.createdAt;
    run.stats = { plannedCreates: 3, failedOperations: 3 };
    const markup = renderToStaticMarkup(createElement(RunLifecycle, { run }));
    expect(markup).toContain(i18n.t('runs:detail.lifecycle.executionRecorded'));
  });
});
