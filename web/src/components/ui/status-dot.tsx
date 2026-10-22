// 发光状态点：颜色表达语义，进行中的状态带呼吸光环；文字标签由调用方提供，颜色不是唯一信息。
import { cn } from '../../lib/utils';

/** 状态点的语义色调。 */
export type StatusTone =
  'active' | 'success' | 'warning' | 'danger' | 'muted' | 'info';

const TONES: Record<StatusTone, string> = {
  active: 'bg-accent text-accent',
  success: 'bg-accent text-accent',
  warning: 'bg-signal text-signal',
  danger: 'bg-danger text-danger',
  info: 'bg-foreground text-foreground',
  muted: 'bg-muted-foreground/60 text-muted-foreground',
};

/** 渲染状态点。
 * @param props tone 语义色调；pulse 是否显示呼吸光环；className 附加样式。
 * @returns 装饰性的状态点。
 * @throws 不适用。
 */
export function StatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: StatusTone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'status-dot',
        TONES[tone],
        pulse && 'status-dot-pulse',
        className,
      )}
    />
  );
}
