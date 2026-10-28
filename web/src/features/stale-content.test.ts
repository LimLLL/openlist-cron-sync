// 后台请求失败仍保留可编辑表单与历史记录，避免把已加载内容替换为错误页。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { InstanceEditPage } from './instances/instance-form-pages';
import type { Instance } from './instances/instance-contract';
import { JobRunsTab } from './jobs/job-detail-runs';
import { mixedRunFixture } from './jobs/job-test-fixture';

const capture = vi.hoisted(() => ({
  data: undefined as unknown,
  refetch: vi.fn(),
}));
vi.mock('./instances/instance-queries', () => ({
  useInstance: () => ({
    data: capture.data,
    isError: true,
    isRefetchError: true,
    error: new Error('offline'),
    refetch: capture.refetch,
  }),
  useUpdateInstance: () => ({ isPending: false, error: null, mutate: vi.fn() }),
}));
vi.mock('./runs/run-queries', async (original) => ({
  ...(await original<typeof import('./runs/run-queries')>()),
  useRuns: () => ({
    data: capture.data,
    isError: true,
    isRefetchError: true,
    error: new Error('offline'),
    refetch: capture.refetch,
  }),
}));

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('stale content after a refresh error', () => {
  it('keeps the instance edit form available after a background error', () => {
    const instance: Instance = {
      id: 'instance',
      name: 'Original',
      baseUrl: 'https://files.example',
      auth: { mode: 'password', username: 'admin', hasSecret: true },
      downloadMode: 'd',
      authState: 'ready',
      authBlockReason: null,
      accountUsername: 'admin',
      accountBasePath: '/',
      openlistVersion: '4.2.5',
      authBlockedUntil: null,
      lastTestAt: null,
      archivedAt: null,
      accountRole: 2,
      accountPermissions: 0,
      multipartEnabled: true,
      lastError: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    capture.data = instance;
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(InstanceEditPage)),
    );
    expect(markup).toContain('<form');
    expect(markup).toContain('value="Original"');
    expect(markup).toContain(i18n.t('common:states.stale'));
    expect(markup).not.toContain('role="alert"');
  });

  it('keeps the job run history visible with a stale notice', () => {
    capture.data = {
      items: [mixedRunFixture()],
      page: 1,
      pageSize: 25,
      total: 1,
    };
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(JobRunsTab, { jobId: 'job' }),
      ),
    );
    expect(markup).toContain('<table');
    expect(markup).toContain('href="/runs/run"');
    expect(markup).toContain(i18n.t('common:states.stale'));
    expect(markup).not.toContain('role="alert"');
  });
});
