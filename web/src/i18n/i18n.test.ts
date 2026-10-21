// 验证真实检测器、资源、复数和错误翻译，不替换 i18next。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const records = new Map<string, string>();
const storage = {
  getItem: (key: string) => records.get(key) ?? null,
  setItem: vi.fn((key: string, value: string) => records.set(key, value)),
  removeItem: (key: string) => records.delete(key),
};

beforeEach(() => {
  vi.resetModules();
  records.clear();
  storage.setItem.mockClear();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage });
  vi.stubGlobal('document', { documentElement: { lang: '' } });
  vi.stubGlobal('navigator', {
    language: 'zh-TW',
    languages: ['zh-TW', 'en-US'],
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('language behavior', () => {
  it('detects a regional browser language without persisting it, then remembers an explicit switch', async () => {
    const {
      default: i18n,
      currentLanguage,
      setLanguage,
      intlLocale,
    } = await import('./index');
    expect(i18n.isInitialized).toBe(true);
    expect(currentLanguage()).toBe('zh');
    expect(intlLocale()).toBe('zh-TW');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(storage.getItem('ocs_lang')).toBeNull();
    await setLanguage('en');
    expect(storage.getItem('ocs_lang')).toBe('en');
    expect(currentLanguage()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('gives an explicit stored language priority over the browser', async () => {
    storage.setItem('ocs_lang', 'en');
    const { currentLanguage } = await import('./index');
    expect(currentLanguage()).toBe('en');
  });

  it('skips an unsupported stored preference and follows the supported browser language', async () => {
    storage.setItem('ocs_lang', 'invalid-language');
    const { currentLanguage } = await import('./index');
    expect(currentLanguage()).toBe('zh');
  });

  it('switches language even when localStorage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new DOMException('Disabled', 'SecurityError');
      },
    });
    const { currentLanguage, setLanguage } = await import('./index');
    await setLanguage('en');
    expect(currentLanguage()).toBe('en');
  });

  it('resolves English singular/plural and Chinese plural keys without fallback keys', async () => {
    const { default: i18n, setLanguage } = await import('./index');
    await setLanguage('en');
    expect(i18n.t('jobs:list.targets', { count: 1 })).toBe('1 target');
    expect(i18n.t('jobs:list.targets', { count: 2 })).toBe('2 targets');
    expect(i18n.t('common:states.retryAfter', { count: 1 })).toBe(
      'Try again in 1 second.',
    );
    await setLanguage('zh');
    expect(i18n.t('common:states.retryAfter', { count: 2 })).toBe(
      '请在 2 秒后重试。',
    );
    expect(i18n.t('runs:detail.targets.title', { count: 1 })).not.toContain(
      'title',
    );
  });

  it('keeps server diagnostics while translating known errors and leaves unknown messages intact', async () => {
    const { default: i18n, setLanguage } = await import('./index');
    const { ErrorState } = await import('../components/states');
    const { ApiError } = await import('../lib/api-client');
    const { errorText } = await import('./error-text');
    const error = new ApiError(
      401,
      'TOKEN_REVOKED',
      'Server diagnostic',
      [],
      'request-123',
    );
    const zh = renderToStaticMarkup(createElement(ErrorState, { error }));
    expect(zh).toContain(i18n.t('errors:TOKEN_REVOKED'));
    expect(zh).toContain('Server diagnostic');
    expect(zh).toContain('request-123');
    await setLanguage('en');
    const en = renderToStaticMarkup(createElement(ErrorState, { error }));
    expect(en).toContain('Your session was revoked. Sign in again.');
    expect(errorText('NEW_SERVER_CODE', 'Original message')).toBe(
      'Original message',
    );
  });

  it('formats dates, durations and an existing form error using the current language', async () => {
    const { default: i18n, setLanguage } = await import('./index');
    const { formatTime, formatDuration } = await import('../lib/format');
    const { JobFormError, jobValidationText } =
      await import('../features/jobs/job-form-model');
    const error = new JobFormError('integerRange', {
      field: 'timeout',
      min: 60,
      max: 604800,
    });
    const time = '2026-10-21T10:00:00Z';
    const zhTime = formatTime(time);
    const zhError = jobValidationText(
      error.key,
      error.params,
      i18n.getFixedT('zh', 'jobs'),
    );
    expect(formatDuration(65)).toBe('1 分 5 秒');
    await setLanguage('en');
    expect(formatDuration(65)).toBe('1m 5s');
    expect(formatTime(time)).not.toBe(zhTime);
    expect(
      jobValidationText(error.key, error.params, i18n.getFixedT('en', 'jobs')),
    ).not.toBe(zhError);
  });
});
