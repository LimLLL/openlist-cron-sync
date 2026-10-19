// 验证固定窗口、无队列容量限制及喷洒请求的计数分配边界。
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../src/configuration/app-config.js';
import { LoginLimiter } from '../src/security/login-limiter.js';
import { ApiError } from '../src/common/errors.js';

/** 获取限流异常用于检查协议。
 * @param action 应被拒绝的动作。
 * @returns 公共错误。
 * @throws Error 未发生预期异常。
 */
function rejection(action: () => void): ApiError {
  try {
    action();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected limiter rejection');
}

/** 读取计数条目数量，仅用于验证内存分配需求，不增加生产诊断接口。
 * @param limiter 被测限流器。
 * @param property 计数集合。
 * @returns 当前条目数。
 * @throws Error 内部值不是集合。
 */
function entries(limiter: LoginLimiter, property: 'ips' | 'usernames'): number {
  const value: unknown = Reflect.get(limiter, property);
  if (!(value instanceof Map)) throw new Error('Missing counters');
  return value.size;
}

/** 注册限流用例。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('login limiter', () => {
  let limiter: LoginLimiter;

  /** 固定时间，使用真实配置默认窗口。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 配置失败。
   */
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    limiter = new LoginLimiter(
      new AppConfig(new ConfigService({ environment: {} })),
    );
  });

  /** 恢复真实时间。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 单 IP 随机用户名喷洒不能继续分配计数。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('allocates only on failure, blocks after five and prunes abandoned usernames', () => {
    for (let index = 0; index < 5; index++) {
      limiter.enter('ip', `name-${index}`);
      limiter.failure('ip', `name-${index}`);
      limiter.leave();
    }
    for (let index = 0; index < 1000; index++)
      expect(
        rejection(() => limiter.enter('ip', `spray-${index}`)).retryAfter,
      ).toBe(900);
    expect(entries(limiter, 'ips')).toBe(1);
    expect(entries(limiter, 'usernames')).toBe(5);
    vi.setSystemTime(900001);
    limiter.enter('ip', 'new');
    expect(entries(limiter, 'ips')).toBe(0);
    expect(entries(limiter, 'usernames')).toBe(0);
    limiter.leave();
  });

  /** 超出两个名额时不排队、不记失败。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('rejects capacity without allocating counters and releases slots', () => {
    limiter.enter('a', 'a');
    limiter.enter('b', 'b');
    expect(rejection(() => limiter.enter('c', 'c')).retryAfter).toBe(1);
    expect(entries(limiter, 'ips')).toBe(0);
    expect(entries(limiter, 'usernames')).toBe(0);
    limiter.leave();
    limiter.enter('c', 'c');
    limiter.leave();
    limiter.leave();
  });

  /** 成功清除用户名而不解除 IP 窗口，窗口从首次失败起算。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('uses independent fixed windows and preserves IP failures after success', () => {
    limiter.failure('ip', 'admin');
    vi.setSystemTime(10000);
    for (let index = 0; index < 4; index++) limiter.failure('ip', 'admin');
    limiter.success('admin');
    limiter.enter('other-ip', 'admin');
    limiter.leave();
    expect(rejection(() => limiter.enter('ip', 'another')).retryAfter).toBe(
      890,
    );
  });
});
