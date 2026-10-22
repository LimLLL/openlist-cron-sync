// 任务模块内共享的小部件：实例名查询、定时状态标签、开关行、等宽标签与路径浏览按钮。
import { useCallback, useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import { FolderSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useInstanceOptions } from './job-queries';
import type { JobView } from './job-contract';

/** 返回按 ID 查询实例名称的函数；未加载或已删除时返回 null。
 * @returns 名称查询函数。
 * @throws 不适用。
 */
export function useInstanceName(): (id: string) => string | null {
  const instances = useInstanceOptions();
  const names = useMemo(
    () => new Map((instances.data ?? []).map((item) => [item.id, item.name])),
    [instances.data],
  );
  return useCallback((id: string) => names.get(id) ?? null, [names]);
}

/** 渲染任务的定时状态，归档优先。
 * @param props job 任务。
 * @returns 状态标签。
 * @throws 不适用。
 */
export function ScheduleBadge({ job }: { job: JobView }) {
  const { t } = useTranslation('jobs');
  if (job.archivedAt)
    return <Badge variant="danger">{t('badge.archived')}</Badge>;
  return job.enabled ? (
    <Badge variant="success" pulse={!!job.cron}>
      {t('badge.enabled')}
    </Badge>
  ) : (
    <Badge>{t('badge.disabled')}</Badge>
  );
}

/** 渲染带说明的开关行；底层是原生复选框，键盘与读屏行为不变。
 * @param props label 标签；hint 说明；checked 当前值；onChange 变化回调。
 * @returns 可点击的开关行。
 * @throws 不适用。
 */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        'group flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-hairline bg-white/[0.015] px-4 py-3.5 transition-colors hover:border-white/15',
        checked && 'border-accent/25 bg-accent/[0.035]',
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && (
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="h-5 w-9 rounded-full border border-hairline bg-white/[0.06] transition-colors peer-checked:border-accent/50 peer-checked:bg-accent/80 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
        />
        <span
          aria-hidden="true"
          className="absolute top-[3px] left-[3px] size-3.5 rounded-full bg-muted-foreground transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] peer-checked:translate-x-4 peer-checked:bg-accent-foreground"
        />
      </span>
    </label>
  );
}

/** 渲染等宽小标签（用于 glob 规则等技术值）。
 * @param props children 内容。
 * @returns 胶囊标签。
 * @throws 不适用。
 */
export function MonoChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center rounded-full border border-hairline bg-white/[0.025] px-2.5 py-1 font-mono text-[12px] break-all">
      {children}
    </span>
  );
}

/** 路径输入框右侧的“浏览”按钮，源与目标共用；未选实例时禁用。
 * @param props disabled 是否禁用；onClick 打开目录选择器。
 * @returns 按钮元素。
 * @throws 不适用。
 */
export function BrowseButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation('jobs');
  return (
    <Button
      variant="secondary"
      className="min-h-12 shrink-0"
      onClick={onClick}
      disabled={disabled}
    >
      <FolderSearch size={15} aria-hidden="true" />
      {t('form.browse')}
    </Button>
  );
}
