// 按当前界面语言格式化时间、字节与持续时间，供列表和详情页使用。
import i18n, { intlLocale } from '../i18n';

/** 解析 ISO 时间，非法或缺失时返回 null。
 * @param iso ISO 时间字符串或 null。
 * @returns Date 或 null。
 * @throws 不适用。
 */
function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 格式化 ISO 时间为本地可读短格式。
 * @param iso ISO 时间字符串或 null。
 * @returns 格式化字符串；null 返回占位符。
 * @throws 不适用。
 */
export function formatTime(iso: string | null | undefined): string {
  const date = parseDate(iso);
  if (!date) return '—';
  return new Intl.DateTimeFormat(intlLocale(), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** 格式化 ISO 时间为完整本地格式（含秒和时区）。
 * @param iso ISO 时间字符串或 null。
 * @returns 格式化字符串。
 * @throws 不适用。
 */
export function formatTimeFull(iso: string | null | undefined): string {
  const date = parseDate(iso);
  if (!date) return '—';
  return new Intl.DateTimeFormat(intlLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

const RELATIVE_STEPS = [
  [60, 'second'],
  [3600, 'minute'],
  [86400, 'hour'],
  [Infinity, 'day'],
] as const;

/** 格式化相对时间（如“3 分钟前”/“3 minutes ago”）。
 * @param iso ISO 时间字符串或 null。
 * @returns 相对时间字符串。
 * @throws 不适用。
 */
export function formatRelative(iso: string | null | undefined): string {
  const date = parseDate(iso);
  if (!date) return '—';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' });
  const absolute = Math.abs(seconds);
  // 一分钟内统一显示“刚刚/now”，避免秒数跳动。
  if (absolute < 60) return formatter.format(0, 'second');
  let divisor = 1;
  for (const [limit, unit] of RELATIVE_STEPS) {
    if (absolute < limit) return formatter.format(Math.trunc(seconds / divisor), unit);
    divisor = limit;
  }
  return formatter.format(Math.trunc(seconds / 86400), 'day');
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 格式化字节数为人类可读单位。
 * @param bytes 字节数或 null。
 * @returns 格式化字符串。
 * @throws 不适用。
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes === 0) return '0 B';
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${BYTE_UNITS[exponent]}`;
}

/** 格式化持续时间秒数。
 * @param seconds 秒数或 null。
 * @returns 格式化字符串（如“1 小时 23 分”/“1h 23m”）。
 * @throws 不适用。
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return i18n.t('common:duration.seconds', { s: seconds });
  if (seconds < 3600)
    return i18n.t('common:duration.minutesSeconds', {
      m: Math.floor(seconds / 60),
      s: seconds % 60,
    });
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0
    ? i18n.t('common:duration.hoursMinutes', { h, m })
    : i18n.t('common:duration.hours', { h });
}
