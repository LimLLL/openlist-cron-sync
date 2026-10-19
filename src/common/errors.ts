// 定义安全的启动异常和公共 HTTP 异常。
import { HttpException } from '@nestjs/common';

/** 字段校验问题；field 为字段路径，reason 为不包含输入值的原因。 */
export interface FieldError {
  /** 字段路径。 */
  field: string;
  /** 固定的校验原因，不回显输入。 */
  reason: string;
}

/** 可写入日志的异常特征；不含 message，避免泄露路径、SQL 参数或秘密。 */
export interface ErrorTraits {
  /** 异常构造器名，例如 SqliteError；不符合类名形态时为 Error。 */
  errorName: string;
  /** 系统、Node 内部、SQLite 或 undici 错误码，例如 EACCES、SQLITE_CORRUPT；没有时省略。 */
  causeCode?: string;
}

const SAFE_CLASS_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
// 只接受已知来源的错误码形态：系统 E*、Node ERR_*、SQLite SQLITE_*、undici UND_ERR_*。
const SAFE_CAUSE_CODE =
  /^(?:E[A-Z0-9]{1,30}|(?:ERR|SQLITE|UND_ERR)_[A-Z0-9_]{1,60})$/;

/** 提取定位根因所需的异常类名与错误码，沿 cause 链最多查三层。
 * @param error 任意异常。
 * @returns 只含类名与错误码的安全特征。
 * @throws 不适用。
 */
export function errorTraits(error: unknown): ErrorTraits {
  if (!(error instanceof Error)) return { errorName: typeof error };
  let current: unknown = error;
  let errorName = 'Error';
  for (let depth = 0; depth < 3 && current instanceof Error; depth++) {
    // 本服务异常的 code 是业务码，已作为 errorCode 记录，继续向 cause 查根因。
    if (current instanceof StartupError || current instanceof ApiError) {
      current = current.cause;
      continue;
    }
    // name 可被任意改写，构造器名才对应实际异常类。
    const className = current.constructor.name;
    errorName = SAFE_CLASS_NAME.test(className) ? className : 'Error';
    if (
      'code' in current &&
      typeof current.code === 'string' &&
      SAFE_CAUSE_CODE.test(current.code)
    )
      return { errorName, causeCode: current.code };
    current = current.cause;
  }
  return { errorName };
}

/** 启动失败的安全摘要。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class StartupError extends Error {
  /** 创建不含秘密的错误；根因只保存在 cause 中，日志经 errorTraits 输出。
   * @param code 错误码。
   * @param message 固定诊断信息。
   * @param cause 原始异常，可省略。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    readonly code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

/** 本服务定义的 HTTP 错误，禁止传入原始异常或凭据。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class ApiError extends HttpException {
  /** 构造公开错误。
   * @param status HTTP 状态。
   * @param code 公共错误码。
   * @param message 固定错误摘要。
   * @param details 字段错误，默认空数组。
   * @param retryAfter 限流等待秒数，其他错误不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details: FieldError[] = [],
    readonly retryAfter?: number,
  ) {
    super(message, status);
  }
}
