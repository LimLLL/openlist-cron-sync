// 使用唯一固定cron版本校验并计算未来时刻，不补齐DST或搜索范围。
import { CronTime } from 'cron';
// cron 4.4.0未从包入口导出CronError；版本已精确固定，升级时须复核此路径。
import { CronError } from 'cron/dist/errors.js';
import { ApiError } from '../common/errors.js';

/** 列表调度诊断，不改变配置写入的HTTP错误码。 */
export const SCHEDULE_ERROR_CODES = [
  'INVALID_TIMEZONE',
  'INVALID_CRON',
  'NO_NEXT_OCCURRENCE',
] as const;

/** 单个Job的只读调度预览。 */
export interface SchedulePreview {
  /** 下一理论触发UTC时刻；没有有效调度时为null。 */
  nextFireAt: string | null;
  /** 可预期的配置或搜索范围诊断；正常或未启用调度时为null。 */
  scheduleError: {
    /** 稳定诊断码，供客户端本地化。 */
    code: (typeof SCHEDULE_ERROR_CODES)[number];
    /** 不回显配置值的固定诊断。 */
    message: string;
  } | null;
}

/** 校验IANA时区、分钟表达式及至少一个可达时刻。
 * @param expression 五段表达式或manual-only的null。
 * @param timezone IANA时区。
 * @returns 不适用。
 * @throws ApiError INVALID_CRON或非法时区。
 */
export function validateSchedule(
  expression: string | null,
  timezone: string,
): void {
  if (expression === null) {
    validateTimezone(timezone);
    return;
  }
  const time = parseSchedule(expression, timezone);
  try {
    time.sendAt();
  } catch (error) {
    if (!(error instanceof CronError)) throw error;
    throw new ApiError(
      400,
      'INVALID_CRON',
      'Cron has no valid next occurrence',
    );
  }
}
/** 校验项目接受的IANA时区；非预期Intl故障向上传递。
 * @param timezone IANA时区。
 * @returns 不适用。
 * @throws ApiError 非法时区；Error 非预期Intl故障。
 */
function validateTimezone(timezone: string): void {
  try {
    // Intl 接受 IANA 别名；显式拒绝新版 Intl 的数字 offset 及 Luxon 的本地/固定区扩展。
    if (/^[+-]|^(?:local|system)$|^UTC[+-]/i.test(timezone))
      throw new RangeError('Timezone');
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    // 与Job其余字段校验保持同一错误形状，不回显输入值。
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid job configuration', [
      { field: 'timezone', reason: 'Invalid value' },
    ]);
  }
}
/** 复用配置写入的时区和五段表达式规则，不检查未来可达性。
 * @param expression 五段cron表达式。
 * @param timezone IANA时区。
 * @returns 固定版本cron解析对象。
 * @throws ApiError 时区或表达式非法；Error 非预期解析故障。
 */
function parseSchedule(expression: string, timezone: string): CronTime {
  validateTimezone(timezone);
  if (expression.trim().split(/\s+/).length !== 5 || expression.includes('@'))
    throw new ApiError(
      400,
      'INVALID_CRON',
      'Expected a five-field cron expression',
    );
  try {
    return new CronTime(expression, timezone);
  } catch (error) {
    if (!(error instanceof CronError)) throw error;
    throw new ApiError(400, 'INVALID_CRON', 'Invalid cron expression');
  }
}
/** 为列表计算一次未来触发；仅把已知配置错误和范围耗尽转换为行内诊断。
 * @param expression 已启用Job的非空cron配置。
 * @param timezone Job时区。
 * @param from 整个列表响应共用的UTC参考时刻。
 * @returns 下一理论时刻或明确诊断；不创建timer或更改配置。
 * @throws Error 非预期解析或时间计算故障。
 */
export function schedulePreview(
  expression: string,
  timezone: string,
  from: Date,
): SchedulePreview {
  let time: CronTime;
  try {
    time = parseSchedule(expression, timezone);
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      !['VALIDATION_ERROR', 'INVALID_CRON'].includes(error.code)
    )
      throw error;
    return {
      nextFireAt: null,
      scheduleError: {
        code:
          error.code === 'VALIDATION_ERROR'
            ? 'INVALID_TIMEZONE'
            : 'INVALID_CRON',
        message:
          error.code === 'VALIDATION_ERROR'
            ? 'Invalid schedule timezone'
            : error.message,
      },
    };
  }
  const nextFireAt = futureTimes(time, timezone, 1, from)[0] ?? null;
  return {
    nextFireAt,
    scheduleError:
      nextFireAt === null
        ? {
            code: 'NO_NEXT_OCCURRENCE',
            message:
              'No execution date was found within the scheduler search horizon',
          }
        : null,
  };
}
/** 计算固定库搜索范围内最多count个时刻；只捕获明确的范围耗尽。
 * @param expression 已校验表达式。
 * @param timezone IANA时区。
 * @param count 最大数量。
 * @param from 查询起点，默认当前UTC。
 * @returns UTC RFC3339数组。
 * @throws Error 非搜索范围耗尽的库错误。
 */
export function nextFireTimes(
  expression: string,
  timezone: string,
  count: number,
  from = new Date(),
): string[] {
  return futureTimes(new CronTime(expression, timezone), timezone, count, from);
}
/** 从已解析表达式计算UTC前缀，供列表和现有未来时刻接口共用。
 * @param time 固定版本cron解析对象。
 * @param timezone 计算时区。
 * @param count 最大时刻数。
 * @param from UTC查询起点。
 * @returns 搜索范围内的UTC时间数组。
 * @throws Error 非搜索范围耗尽的库错误。
 */
function futureTimes(
  time: CronTime,
  timezone: string,
  count: number,
  from: Date,
): string[] {
  const result: string[] = [];
  let cursor = from;
  for (let index = 0; index < count; index++) {
    try {
      const next = time.getNextDateFrom(cursor, timezone);
      cursor = next.toJSDate();
      result.push(cursor.toISOString());
    } catch (error) {
      // cron 4.4.0没有专用范围错误类型，只匹配其固定范围错误，不吞掉其它计算错误。
      if (
        error instanceof CronError &&
        error.message.startsWith(
          'Something went wrong. No execution date was found in the next 8 years.',
        )
      )
        break;
      throw error;
    }
  }
  return result;
}
