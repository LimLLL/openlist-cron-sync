// 验证操作契约的两层结构：列表只有逻辑操作摘要，详情的尝试记录必须与尝试次数一致，退避中的操作显示为等待重试。
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import i18n from '../../i18n';
import { formatBytes } from '../../lib/format';
import { OperationDetails } from './operation-details';
import {
  awaitingRetry,
  parseOperation,
  parseOperationDetail,
} from './operation-contract';

/** 构造一个公开字段齐全的逻辑操作摘要。
 * @param overrides 覆盖字段。
 * @returns 后端 OperationView 形状的 JSON。
 * @throws 不适用。
 */
function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'operation',
    runId: 'run',
    runTargetId: 'target',
    seq: 3,
    action: 'create',
    method: 'relay',
    reason: 'new',
    status: 'succeeded',
    sourceInstanceId: 'source',
    sourceInstanceName: 'Source',
    sourcePath: '/source/a.txt',
    targetInstanceId: 'dest',
    targetInstanceName: 'Dest',
    targetPath: '/target/a.txt',
    isDir: false,
    expectedSourceSize: 7,
    expectedTargetSize: null,
    affectedFileCount: 1,
    affectedBytes: 7,
    attemptCount: 2,
    bytesDownloaded: 12,
    bytesTransferred: 9,
    error: null,
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:01:00.000Z',
    submittedAt: '2026-10-29T00:00:01.000Z',
    endedAt: '2026-10-29T00:01:00.000Z',
    unknownSince: null,
    ...overrides,
  };
}

/** 构造一次尝试。
 * @param attemptNo 尝试编号。
 * @param status 尝试状态。
 * @returns 后端 AttemptView 形状的 JSON。
 * @throws 不适用。
 */
function attempt(attemptNo: number, status: string) {
  return {
    id: `attempt-${attemptNo}`,
    attemptNo,
    status,
    task: null,
    remoteCleanupPending: false,
    multipart: null,
    bytesDownloaded: 6,
    bytesTransferred: 4,
    error:
      status === 'failed'
        ? { code: 'OPENLIST_ERROR', message: 'Download HTTP 503' }
        : null,
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:30.000Z',
    submittedAt: '2026-10-29T00:00:01.000Z',
    endedAt: '2026-10-29T00:00:30.000Z',
    nextAttemptAt: null,
    unknownSince: null,
  };
}

/** 注册操作契约验收。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('operation contract', () => {
  /** 一次失败后重试成功只是一条成功的操作，失败那次只在尝试记录里。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 解析或断言失败。
   */
  it('parses one logical operation with its attempt history', () => {
    const detail = parseOperationDetail({
      ...summary(),
      attempts: [attempt(1, 'failed'), attempt(2, 'succeeded')],
    });
    expect(detail).toMatchObject({ status: 'succeeded', attemptCount: 2 });
    expect(detail.attempts.map((item) => item.status)).toEqual([
      'failed',
      'succeeded',
    ]);
    expect(detail.attempts[0].error?.message).toBe('Download HTTP 503');
    expect(parseOperation(summary())).not.toHaveProperty('attempts');
  });

  /** 尝试缺失、多出或编号不连续都说明响应不可信，不能拼出半截历史。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('rejects attempt lists that do not match the attempt count', () => {
    for (const attempts of [
      [attempt(1, 'succeeded')],
      [attempt(1, 'failed'), attempt(3, 'succeeded')],
      [attempt(2, 'failed'), attempt(1, 'succeeded')],
    ])
      expect(() => parseOperationDetail({ ...summary(), attempts })).toThrow();
    expect(() => parseOperationDetail(summary())).toThrow();
  });

  /** 操作至少有首次尝试；列表与详情都不能接受零、负数或非整数计数。
   * @param count 非法尝试数。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid attempt count: %s',
    (count) => {
      expect(() => parseOperation(summary({ attemptCount: count }))).toThrow();
      expect(() =>
        parseOperationDetail({
          ...summary({ attemptCount: count }),
          attempts: [],
        }),
      ).toThrow();
    },
  );

  /** 源准备先于目标提交，期间失败仍须展示该次已消耗的下载字节。
   * @param language 界面语言。
   * @returns 渲染验证完成。
   * @throws Error 解析或断言失败。
   */
  it.each(['zh', 'en'])(
    'shows pre-submission download bytes in %s',
    async (language) => {
      await i18n.changeLanguage(language);
      const operation = parseOperationDetail({
        ...summary({ bytesDownloaded: 4096, bytesTransferred: 3072 }),
        attempts: [
          {
            ...attempt(1, 'failed'),
            submittedAt: null,
            bytesDownloaded: 1024,
            bytesTransferred: 0,
          },
          {
            ...attempt(2, 'succeeded'),
            bytesDownloaded: 3072,
            bytesTransferred: 3072,
          },
        ],
      });
      const markup = renderToStaticMarkup(
        createElement(
          MemoryRouter,
          null,
          createElement(OperationDetails, { operation }),
        ),
      );
      expect(markup).toContain(formatBytes(1024));
      expect(markup).toContain('Download HTTP 503');
    },
  );

  /** 只有已失败过且仍在等待的操作是“等待重试”；首次待执行和已结束的都不是。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('marks only pending operations with earlier attempts as awaiting retry', () => {
    expect(awaitingRetry({ status: 'pending', attemptCount: 2 })).toBe(true);
    expect(awaitingRetry({ status: 'pending', attemptCount: 1 })).toBe(false);
    expect(awaitingRetry({ status: 'failed', attemptCount: 3 })).toBe(false);
    expect(awaitingRetry({ status: 'running', attemptCount: 2 })).toBe(false);
  });
});
