// 使用唯一固定cron版本校验并计算未来时刻，不补齐DST或搜索范围。
import { CronTime } from 'cron';
// cron 4.4.0未从包入口导出CronError；版本已精确固定，升级时须复核此路径。
import { CronError } from 'cron/dist/errors.js';
import { ApiError } from '../common/errors.js';

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
  try {
    // Intl 接受 IANA 别名；显式拒绝新版 Intl 的数字 offset 及 Luxon 的本地/固定区扩展。
    if (/^[+-]|^(?:local|system)$|^UTC[+-]/i.test(timezone))
      throw new RangeError('Timezone');
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    // 与Job其余字段校验保持同一错误形状，不回显输入值。
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid job configuration', [
      { field: 'timezone', reason: 'Invalid value' },
    ]);
  }
  if (expression === null) return;
  if (expression.trim().split(/\s+/).length !== 5 || expression.includes('@'))
    throw new ApiError(
      400,
      'INVALID_CRON',
      'Expected a five-field cron expression',
    );
  let time: CronTime;
  try {
    time = new CronTime(expression, timezone);
  } catch (error) {
    if (!(error instanceof CronError)) throw error;
    throw new ApiError(400, 'INVALID_CRON', 'Invalid cron expression');
  }
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
  const time = new CronTime(expression, timezone);
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
