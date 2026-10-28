// 验证清除筛选只发起一次URL导航，保留无关标签、页大小和排序。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useClearFilters } from './hooks';

const state = vi.hoisted(() => ({
  params: new URLSearchParams(),
  navigate: vi.fn(),
}));
vi.mock('react-router', () => ({
  useSearchParams: () => [state.params, state.navigate],
}));

beforeEach(() => {
  state.navigate.mockReset();
  state.navigate.mockImplementation(
    (update: (value: URLSearchParams) => URLSearchParams) => {
      state.params = update(state.params);
    },
  );
});

describe('URL filter resets', () => {
  it('clears every run filter together and resets only its page', () => {
    state.params = new URLSearchParams(
      'jobId=job&status=failed&dryRun=false&page=3&pageSize=25&sort=name',
    );
    useClearFilters(['jobId', 'status', 'dryRun'])();
    expect(state.navigate).toHaveBeenCalledOnce();
    expect(state.params.toString()).toBe('pageSize=25&sort=name');
  });

  it('preserves the operation panel, current tab and other tables when clearing operation filters', () => {
    state.params = new URLSearchParams(
      'opStatus=failed&opAction=create&opsPage=4&opsPageSize=25&issuesPage=2&tab=operations&op=selected',
    );
    useClearFilters(['opStatus', 'opAction'], 'opsPage')();
    expect(state.navigate).toHaveBeenCalledOnce();
    expect(state.params.toString()).toBe(
      'opsPageSize=25&issuesPage=2&tab=operations&op=selected',
    );
  });
});
