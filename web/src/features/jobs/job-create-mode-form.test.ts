// 验证实际表单的禁用选项、行内错误、两个提交按钮及提交入口，不启动浏览器或服务。
import { Children, createElement, isValidElement } from 'react';
import type { FormEvent, ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { JobForm } from './job-form';
import { mixedJobFixture } from './job-test-fixture';

const mutation = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  mutate: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => [
    typeof initial === 'function' ? initial() : initial,
    vi.fn(),
  ],
}));
vi.mock('react-router', async (original) => ({
  ...(await original<typeof import('react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: i18n.getFixedT(i18n.language, ['jobs', 'common']),
  }),
}));
vi.mock('./job-queries', () => ({
  useCreateJob: () => mutation,
  usePatchJob: () => mutation,
  useInstanceOptions: () => ({
    data: [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Source' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Other' },
    ],
  }),
}));

/** 从实际 React 元素树取得原生表单，直接验证键盘提交所走的入口。
 * @param node 表单组件返回的元素。
 * @returns 原生表单元素，或尚未找到时的 undefined。
 * @throws 不适用。
 */
function findForm(
  node: ReactNode,
): ReactElement<{ onSubmit: (event: FormEvent) => void }> | undefined {
  if (
    !isValidElement<{
      children?: ReactNode;
      onSubmit: (event: FormEvent) => void;
    }>(node)
  )
    return;
  if (node.type === 'form') return node;
  for (const child of Children.toArray(node.props.children)) {
    const found = findForm(child);
    if (found) return found;
  }
}

/** 清空提交记录并固定默认语言。
 * @param 不适用。
 * @returns 初始化完成。
 * @throws Error 翻译初始化失败。
 */
beforeEach(async () => {
  mutation.mutate.mockClear();
  await i18n.changeLanguage('en');
});

/** 注册表单行为验收。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('Target create mode form', () => {
  /** 实例修改产生显式行内错误，按钮与直接提交均阻止请求。
   * @param language 显示语言。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it.each(['en', 'zh'])(
    'preserves an invalid copy selection and blocks all submits in %s',
    async (language) => {
      await i18n.changeLanguage(language);
      const job = mixedJobFixture();
      job.source.instanceId = job.targets[1].instanceId;
      const element = JobForm({ existing: job });
      const markup = renderToStaticMarkup(
        createElement(MemoryRouter, null, element),
      );
      const submits = markup.match(/<button[^>]*type="submit"[^>]*>/g);
      expect(submits).toHaveLength(2);
      for (const button of submits ?? [])
        expect(button).toContain('disabled=""');
      expect(markup).toContain('aria-checked="true" disabled=""');
      expect(markup).toContain('role="alert"');
      expect(markup).toContain(
        i18n.t('jobs:validation.serverCopySameInstance'),
      );
      const form = findForm(element);
      if (!form) throw new Error('Missing form');
      const event = { preventDefault: vi.fn() } as unknown as FormEvent;
      form.props.onSubmit(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mutation.mutate).not.toHaveBeenCalled();
      expect(job.targets[0].createMode).toBe('server_copy');
    },
  );
  /** 合法混合配置可提交，不发送 Job 级字段。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('submits a valid mixed configuration and leaves unselected Instances to required validation', () => {
    const job = mixedJobFixture();
    const element = JobForm({ existing: job });
    const form = findForm(element);
    if (!form) throw new Error('Missing form');
    form.props.onSubmit({ preventDefault: vi.fn() } as unknown as FormEvent);
    expect(mutation.mutate).toHaveBeenCalledOnce();
    expect(mutation.mutate.mock.calls[0][0]).not.toHaveProperty('createMode');
    expect(mutation.mutate.mock.calls[0][0].targets).toMatchObject([
      { createMode: 'server_copy' },
      { createMode: 'relay' },
    ]);
    job.source.instanceId = '';
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, JobForm({ existing: job })),
    );
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain(
      i18n.t('jobs:validation.serverCopySameInstance'),
    );
  });
});
