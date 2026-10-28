// 验证资格刷新不会卸载打开的确认框，结果不明时保留提示，并遵守禁用、隐藏与删除确认规则。
import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Trans } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorState } from '../../components/states';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent } from '../../components/ui/dialog';
import { SwitchField } from '../../components/ui/switch';
import { toast } from '../../components/ui/toast';
import { ApiError } from '../../lib/api-client';
import { mixedRunFixture } from '../jobs/job-test-fixture';
import { parseRunDetail } from './run-contract';
import type { RetryReason, RunDetail } from './run-contract';
import { RetryRunButton } from './run-retry-dialog';

const capture = vi.hoisted(() => ({
  state: [] as unknown[],
  cursor: 0,
  retry: {
    isPending: false,
    error: null as Error | null,
    mutate: vi.fn(),
    reset: vi.fn(),
  },
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => {
    const index = capture.cursor++;
    if (!(index in capture.state)) capture.state[index] = initial;
    return [
      capture.state[index],
      (value: unknown) => {
        capture.state[index] = value;
      },
    ];
  },
}));
vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./run-queries', () => ({ useRetryRun: () => capture.retry }));
vi.mock('../../components/ui/toast', () => ({ toast: vi.fn() }));

/** 查找可见返回树中的元素，保留实际事件处理器；关闭的对话框内容不可见。
 * @param node 当前节点。
 * @param match 元素谓词。
 * @returns 匹配元素或undefined。
 * @throws 不适用。
 */
function find(
  node: ReactNode,
  match: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (match(node)) return node;
  if (node.type === Dialog && !node.props.open) return;
  for (const child of Children.toArray(node.props.children as ReactNode)) {
    const found = find(child, match);
    if (found) return found;
  }
}

/** 使用同一组hook状态重新渲染，模拟请求期间详情资格刷新。
 * @param run 当前运行详情。
 * @returns 实际组件返回树。
 * @throws Error 组件失败。
 */
function render(run: RunDetail) {
  capture.cursor = 0;
  return RetryRunButton({ run, name: 'Files' });
}

let run: RunDetail;
beforeEach(() => {
  capture.state = [];
  capture.retry.isPending = false;
  capture.retry.error = null;
  vi.clearAllMocks();
  run = parseRunDetail(mixedRunFixture());
  run.dryRun = false;
  run.retryEligibility = {
    eligible: true,
    reason: null,
    candidateFiles: 9,
    candidateDirectories: 1,
    excludedItems: 2,
  };
});

describe('retry confirmation lifecycle', () => {
  it('defaults delete confirmation off on every opening and submits the selected value', () => {
    // 曾经打开过开关，重新打开确认框时也必须默认关闭。
    capture.state = [false, true];
    const trigger = find(render(run), (node) => node.type === Button)!;
    (trigger.props.onClick as () => void)();
    let tree = render(run);
    const switchField = find(tree, (node) => node.type === SwitchField)!;
    expect(switchField.props.checked).toBe(false);
    expect(capture.retry.reset).toHaveBeenCalledOnce();
    (switchField.props.onCheckedChange as (value: boolean) => void)(true);
    tree = render(run);
    const form = find(tree, (node) => node.type === 'form')!;
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
      preventDefault: vi.fn(),
    });
    expect(capture.retry.mutate).toHaveBeenCalledWith(
      { id: run.id, confirmDeletes: true },
      expect.any(Object),
    );
    const options = capture.retry.mutate.mock.calls[0][1] as {
      onSuccess: (created: { id: string }) => void;
    };
    options.onSuccess({ id: 'retry-run' });
    expect(find(render(run), (node) => node.type === Dialog)?.props.open).toBe(
      false,
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        action: { label: 'common:runDialog.view', to: '/runs/retry-run' },
      }),
    );
  });

  it.each(['JOB_BUSY', 'RUN_SUPERSEDED'] as const)(
    'keeps an open dialog and ambiguous error when eligibility becomes %s',
    (reason) => {
      const trigger = find(render(run), (node) => node.type === Button)!;
      (trigger.props.onClick as () => void)();
      capture.retry.isPending = true;
      run.retryEligibility = {
        eligible: false,
        reason,
        candidateFiles: 0,
        candidateDirectories: 0,
        excludedItems: 0,
      };
      let tree = render(run);
      const dialog = find(tree, (node) => node.type === Dialog)!;
      expect(dialog.props.open).toBe(true);
      expect(
        find(tree, (node) => node.type === DialogContent)?.props.closeDisabled,
      ).toBe(true);
      (dialog.props.onOpenChange as (open: boolean) => void)(false);
      expect(
        find(render(run), (node) => node.type === Dialog)?.props.open,
      ).toBe(true);

      capture.retry.isPending = false;
      capture.retry.error = new ApiError(0, 'NETWORK_ERROR', 'Connection lost');
      tree = render(run);
      expect(find(tree, (node) => node.type === ErrorState)?.props.error).toBe(
        capture.retry.error,
      );
      expect(find(tree, (node) => node.type === Trans)?.props.i18nKey).toBe(
        'common:runDialog.ambiguous',
      );
      expect(
        find(tree, (node) => node.props.role === 'status')?.props.children,
      ).toBe(`detail.retry.reason.${reason}`);
      expect(
        find(
          tree,
          (node) => node.type === Button && node.props.type === 'submit',
        )?.props.disabled,
      ).toBe(true);
      const form = find(tree, (node) => node.type === 'form')!;
      (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
        preventDefault: vi.fn(),
      });
      expect(capture.retry.mutate).not.toHaveBeenCalled();
      (dialog.props.onOpenChange as (open: boolean) => void)(false);
      expect(
        find(render(run), (node) => node.type === Dialog)?.props.open,
      ).toBe(false);
    },
  );

  it.each([
    ['JOB_BUSY', true],
    ['SOURCE_ENDPOINT_CHANGED', true],
    ['HISTORY_EXPIRED', true],
    ['RUN_SUPERSEDED', false],
    ['JOB_ARCHIVED', false],
    ['NO_RETRY_ITEMS', false],
    ['RUN_NOT_TERMINAL', false],
    ['DRY_RUN', false],
  ] satisfies [RetryReason, boolean][])(
    'shows a disabled entry for %s only when required',
    (reason, shown) => {
      run.retryEligibility.eligible = false;
      run.retryEligibility.reason = reason;
      const button = find(render(run), (node) => node.type === Button);
      if (shown) expect(button?.props.disabled).toBe(true);
      else expect(button).toBeUndefined();
    },
  );
});
