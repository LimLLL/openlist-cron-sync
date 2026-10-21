// 工具栏用的胶囊下拉框：与分段选择器同高，标签只给读屏软件。
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** 渲染紧凑的筛选下拉框。
 * @param props label 无障碍名称；value 当前值；onChange 选择回调；children option 列表。
 * @returns 带隐藏标签的 select。
 * @throws 不适用。
 */
export function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-[2.375rem] appearance-none rounded-full border border-hairline bg-white/[0.02] pr-9 pl-4 text-xs font-medium text-foreground transition-colors hover:border-white/20 focus:border-accent/60 focus:outline-none"
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-3.5 text-muted-foreground"
        aria-hidden="true"
      />
    </label>
  );
}
