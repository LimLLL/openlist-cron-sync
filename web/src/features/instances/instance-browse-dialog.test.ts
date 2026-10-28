// 验证目录选择只提交已成功浏览的路径/密码，以及失败重试保留本次请求页码。
import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorState } from '../../components/states';
import { Button } from '../../components/ui/button';
import { InstanceBrowseDialog } from './instance-browse-dialog';
import type { BrowseResult } from './instance-contract';

const capture = vi.hoisted(() => ({
  state: [] as unknown[],
  browse: {
    isPending: false,
    isError: false,
    error: new Error('Browse failed'),
    variables: { path: '/listed', password: 'accepted', page: 1 },
    mutate: vi.fn(),
    reset: vi.fn(),
  },
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: () => [capture.state.shift(), vi.fn()],
  useEffect: () => {},
}));
vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../i18n/error-text', () => ({ useErrorText: () => vi.fn() }));
vi.mock('./instance-queries', () => ({
  useInstanceBrowse: () => capture.browse,
}));

/** 查找组件返回树中的交互入口，不替换实际按钮的处理逻辑。
 * @param node 当前元素。
 * @param match 元素匹配函数。
 * @returns 匹配的元素或undefined。
 * @throws 不适用。
 */
function find(
  node: ReactNode,
  match: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (match(node)) return node;
  for (const child of Children.toArray([
    node.props.children as ReactNode,
    node.props.footer as ReactNode,
  ])) {
    const found = find(child, match);
    if (found) return found;
  }
}

/** 准备有成功列表的组件状态。
 * @param pathInput 当前输入路径。
 * @param password 当前输入密码。
 * @returns 选择回调与组件树。
 * @throws 不适用。
 */
function dialog(pathInput: string, password: string) {
  const listing: BrowseResult = {
    path: '/listed',
    page: 5,
    pageSize: 50,
    total: 300,
    write: true,
    warnings: [],
    items: [],
  };
  capture.state = [capture.browse.variables.path, pathInput, password, listing];
  const onSelect = vi.fn();
  return {
    onSelect,
    tree: InstanceBrowseDialog({
      instanceId: 'instance',
      instanceName: 'Files',
      open: true,
      onOpenChange: vi.fn(),
      onSelect,
    }),
  };
}

beforeEach(() => {
  capture.browse.isPending = false;
  capture.browse.isError = false;
  capture.browse.variables = { path: '/listed', password: 'accepted', page: 1 };
  capture.browse.mutate.mockReset();
});

describe('directory selection', () => {
  it.each([
    ['/listed', 'accepted', false, false, true],
    ['/unopened', 'accepted', false, false, false],
    ['/listed', 'edited password', false, false, false],
    ['/listed', 'accepted', true, false, false],
    ['/listed', 'accepted', false, true, false],
  ])(
    'gates selection for path=%s password=%s pending=%s error=%s',
    (path, password, pending, error, allowed) => {
      capture.browse.isPending = pending;
      capture.browse.isError = error;
      const { tree, onSelect } = dialog(path, password);
      const select = find(
        tree,
        (node) =>
          node.type === Button && node.props.children === 'browse.selectFolder',
      );
      if (!select) throw new Error('Missing directory selection button');
      expect(select.props.disabled).toBe(!allowed);
      (select.props.onClick as () => void)();
      if (allowed) expect(onSelect).toHaveBeenCalledWith('/listed', 'accepted');
      else expect(onSelect).not.toHaveBeenCalled();
    },
  );

  it('retries the failed folder request page instead of the previous successful listing page', () => {
    capture.browse.isError = true;
    capture.browse.variables.path = '/failed-folder';
    const { tree } = dialog('/failed-folder', 'accepted');
    const error = find(tree, (node) => node.type === ErrorState);
    if (!error) throw new Error('Missing browse retry action');
    (error.props.onRetry as () => void)();
    expect(capture.browse.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/failed-folder', page: 1 }),
      expect.any(Object),
    );
  });
});
