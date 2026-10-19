// 验证 M1 环境边界，并确保未来里程碑变量尚未读取。
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../src/configuration/app-config.js';
import { environmentFor } from './helpers.js';

describe('M1 configuration', /** 注册本组 M1 行为验收用例。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
() => {
  it.each([
    ['OPENLIST_CONNECT_TIMEOUT_MS', '999'],
    ['OPENLIST_CONNECT_TIMEOUT_MS', '120001'],
    ['OPENLIST_API_TIMEOUT_MS', '999'],
    ['OPENLIST_API_TIMEOUT_MS', '300001'],
    ['RETRY_MAX_ATTEMPTS', '0'],
    ['RETRY_MAX_ATTEMPTS', '11'],
    ['RETRY_BASE_MS', '99'],
    ['RETRY_BASE_MS', '60001'],
    ['RETRY_MAX_MS', '999'],
    ['RETRY_MAX_MS', '300001'],
    ['OPENLIST_AUTH_COOLDOWN_SECONDS', '599'],
    ['OPENLIST_AUTH_COOLDOWN_SECONDS', '86401'],
    ['OPENLIST_MAX_JSON_BYTES', '1023'],
    ['OPENLIST_MAX_JSON_BYTES', '268435457'],
    ['RETRY_MAX_ATTEMPTS', '1.5'],
    ['OPENLIST_API_TIMEOUT_MS', 'secret'],
  ])(
    'rejects %s outside its documented range',

    /** 验证当前场景的协议输入、输出与副作用。
     * @param name 变量或条目名。
     * @param value 待验证字段值。
     * @returns 断言完成；异步用例返回完成 Promise。
     * @throws Error 断言或测试资源操作失败。
     */
    (name, value) => {
      expect(
        /** 创建配置以验证非法环境值立即失败。
         * @param 不适用。
         * @returns 有效配置。
         * @throws StartupError 环境字段非法。
         */
        () =>
          new AppConfig(
            new ConfigService({
              environment: environmentFor('/tmp/m1-config', { [name]: value }),
            }),
          ),
      ).toThrow(`Invalid configuration: ${name}`);
    },
  );
  it('ignores unimplemented milestone environment settings', /** 验证当前场景的协议输入、输出与副作用。
   * @param 不适用。
   * @returns 断言完成；异步用例返回完成 Promise。
   * @throws Error 断言或测试资源操作失败。
   */
  () => {
    const config = new AppConfig(
      new ConfigService({
        environment: environmentFor('/tmp/m1-config', {
          OPENLIST_TASK_POLL_MS: 'invalid',
          RELAY_TOTAL_TIMEOUT_SECONDS: 'invalid',
          SCAN_MAX_DIRECTORY_ENTRIES: 'invalid',
        }),
      }),
    );
    expect(config.openlistConnectTimeoutMs).toBe(10000);
    expect(config.openlistApiTimeoutMs).toBe(30000);
    expect(config.retryMaxAttempts).toBe(3);
    expect(config.retryMaxMs).toBe(30000);
  });
  /** 覆盖只提高 base 而未同时提高默认 max 的跨字段边界。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('requires retry max to remain at least retry base even when max is omitted', () => {
    expect(
      /** 以冲突的默认上限构造配置。
       * @param 不适用。
       * @returns 配置对象。
       * @throws StartupError RETRY_MAX_MS 小于 base。
       */
      () =>
        new AppConfig(
          new ConfigService({
            environment: environmentFor('/tmp/m1-config', {
              RETRY_BASE_MS: '60000',
            }),
          }),
        ),
    ).toThrow('Invalid configuration: RETRY_MAX_MS');
  });
});
