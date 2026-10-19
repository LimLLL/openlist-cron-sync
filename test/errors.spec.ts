// 验证诊断信息只包含受信任分类且不会被外层业务码截断。
import Database from 'better-sqlite3';
import { errorTraits, StartupError } from '../src/common/errors.js';

/** 注册异常诊断的安全边界测试。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('safe error diagnostics', () => {
  /** 业务包装码不应覆盖三层内真正的 SQLite 原因。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('finds the SQLite cause through application and query wrappers', () => {
    const sqlite = new Database.SqliteError(
      'private SQL parameters',
      'SQLITE_NOTADB',
    );
    const query = new Error('query with private parameters', { cause: sqlite });
    expect(
      errorTraits(new StartupError('INTERNAL_ERROR', 'Safe summary', query)),
    ).toEqual({
      errorName: 'SqliteError',
      causeCode: 'SQLITE_NOTADB',
    });
  });

  /** Error.name 可被覆盖，大写字符串也不等于有效错误码。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('does not log arbitrary names, codes, messages or thrown values', () => {
    const error = Object.assign(new TypeError('password=private-value'), {
      name: 'password=private-value',
      code: 'PRIVATE_ACCESS_TOKEN',
    });
    expect(errorTraits(error)).toEqual({ errorName: 'TypeError' });
    expect(errorTraits('private-value')).toEqual({ errorName: 'string' });
    expect(errorTraits({ code: 'PRIVATE_ACCESS_TOKEN' })).toEqual({
      errorName: 'object',
    });
  });

  /** 正常的系统错误码保持可诊断，不保留文件路径。
   * @param code 系统错误码。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it.each(['EACCES', 'ENOSPC', 'EADDRINUSE', 'ENOTFOUND'])(
    'preserves system classification %s',
    (code) => {
      expect(
        errorTraits(Object.assign(new Error('/private/path'), { code })),
      ).toEqual({ errorName: 'Error', causeCode: code });
    },
  );

  /** SQLite 扩展码保留以区分具体 I/O 或约束原因，非已知来源的码不进入日志。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('keeps SQLite extended codes and drops codes from unknown sources', () => {
    expect(
      errorTraits(new Database.SqliteError('private', 'SQLITE_IOERR_FSYNC')),
    ).toEqual({ errorName: 'SqliteError', causeCode: 'SQLITE_IOERR_FSYNC' });
    expect(
      errorTraits(
        Object.assign(new Error('private'), { code: 'UPSTREAM_PRIVATE_TOKEN' }),
      ),
    ).toEqual({ errorName: 'Error' });
  });

  /** cause 链有界遍历，不为循环或深层对象引入额外状态。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('stops at three error objects and tolerates a cause cycle', () => {
    const root = new Database.SqliteError('private', 'SQLITE_FULL');
    const wrapped = new Error('one', {
      cause: new Error('two', { cause: new Error('three', { cause: root }) }),
    });
    expect(errorTraits(wrapped)).toEqual({ errorName: 'Error' });
    const cyclic = new Error('private');
    cyclic.cause = cyclic;
    expect(errorTraits(cyclic)).toEqual({ errorName: 'Error' });
  });
});
