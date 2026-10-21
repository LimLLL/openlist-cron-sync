// 中英文切换胶囊：当前语言高亮，选择后持久化到 localStorage。
import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { currentLanguage, setLanguage } from '../i18n';
import type { Language } from '../i18n';
import { cn } from '../lib/utils';

const OPTIONS: ReadonlyArray<{ value: Language; label: string }> = [
  { value: 'zh', label: '中' },
  { value: 'en', label: 'EN' },
];

/** 渲染语言切换控件；选项文字固定为各自语言，任何语言下都能认出来。
 * @param props 附加样式。
 * @returns 语言切换单选组。
 * @throws 不适用。
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t } = useTranslation('common');
  const active = currentLanguage();
  return (
    <div
      role="radiogroup"
      aria-label={t('language.label')}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised/60 p-1 text-[11px]',
        className,
      )}
    >
      <Languages size={13} className="mx-1.5 text-muted-foreground" aria-hidden="true" />
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={active === option.value}
          lang={option.value === 'zh' ? 'zh-CN' : 'en'}
          onClick={() => void setLanguage(option.value)}
          className={cn(
            'min-w-8 rounded-full px-2.5 py-1 font-medium transition-colors',
            active === option.value
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
