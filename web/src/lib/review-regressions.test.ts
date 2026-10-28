// 验证分页、204 和健康响应等容易被正常构建遗漏的行为契约。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './api-client';
import { parsePageParams } from './hooks';
import { parseEmpty, parsePage } from './parsers';
import { parseHealth } from '../features/dashboard/dashboard-contract';
import { parseRunDetail, parseRunView } from '../features/runs/run-contract';
import {
  operationNeedsPolling,
  parseOperation,
} from '../features/operations/operation-contract';

afterEach(() => vi.unstubAllGlobals());

describe('review regressions', () => {
  it('keeps operations and issues pagination independent', () => {
    const params = new URLSearchParams('operationsPage=10&issuesPage=2');
    expect(
      parsePageParams(params, { page: 1, pageSize: 25 }, 'operations').page,
    ).toBe(10);
    expect(
      parsePageParams(params, { page: 1, pageSize: 25 }, 'issues').page,
    ).toBe(2);
  });
  it.each(['1junk', 'Infinity', '9007199254740992', '1.5'])(
    'rejects invalid page %s',
    (page) => {
      expect(
        parsePageParams(new URLSearchParams({ page }), {
          page: 1,
          pageSize: 50,
        }).page,
      ).toBe(1);
    },
  );
  it('rejects invalid response page sizes rather than dividing by zero', () => {
    expect(() =>
      parsePage({ items: [], page: 1, pageSize: 0, total: 0 }, String, 'items'),
    ).toThrow();
  });
  it('handles 204 through a session-compatible parser and still rejects missing JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(
      apiRequest('/jobs/id', { method: 'DELETE', parse: parseEmpty }),
    ).resolves.toBeUndefined();
    await expect(
      apiRequest('/runs/id', { parse: parseRunDetail }),
    ).rejects.toThrow('Invalid run');
  });
  it('accepts the documented unhealthy 503 response only for health requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () =>
          Response.json(
            { status: 'not_ready', database: 'error' },
            { status: 503 },
          ),
        ),
    );
    await expect(
      apiRequest('/system/health/ready', {
        acceptedStatuses: [503],
        parse: parseHealth,
      }),
    ).resolves.toEqual({ status: 'not_ready', database: 'error' });
    await expect(
      apiRequest('/jobs', { parse: parseHealth }),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('does not accept incomplete records as valid run or operation data', () => {
    expect(() => parseRunView({ id: 'run', status: 'executing' })).toThrow();
    expect(() =>
      parseOperation({ id: 'operation', status: 'unknown' }),
    ).toThrow();
  });
  it('polls active operations but leaves terminal unknown outcomes as history', () => {
    expect(operationNeedsPolling({ status: 'running' })).toBe(true);
    for (const status of [
      'unknown',
      'succeeded',
      'failed',
      'cancelled',
      'skipped',
    ] as const)
      expect(operationNeedsPolling({ status })).toBe(false);
  });
});
