// 全部计数与配置快照：计数以规格表展示非零项，快照默认收起，展开为等宽 JSON。
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { SpecGrid } from '../../components/ui/spec-grid';
import { formatBytes } from '../../lib/format';
import { intlLocale } from '../../i18n';
import type { RunDetail } from './run-contract';
import { isByteStat, isStatKey } from './run-format';
import { cn } from '../../lib/utils';

const EASE = [0.16, 1, 0.3, 1] as const;

/** 渲染全部非零计数。
 * @param props stats 运行统计。
 * @returns 规格表或空提示。
 * @throws 不适用。
 */
export function RunStatistics({ stats }: { stats: Record<string, number> }) {
  const { t } = useTranslation('runs');
  const entries = Object.entries(stats).filter(([, value]) => value > 0);
  if (entries.length === 0)
    return (
      <p className="text-sm text-muted-foreground">{t('detail.noStats')}</p>
    );
  const number = new Intl.NumberFormat(intlLocale());
  return (
    <SpecGrid
      columns={4}
      items={entries.map(([key, value]) => ({
        // 后端新增字段没有翻译时，把驼峰名拆成单词显示。
        label: isStatKey(key)
          ? t(`detail.stats.${key}`)
          : key.replace(/([A-Z])/g, ' $1').trim(),
        value: isByteStat(key) ? formatBytes(value) : number.format(value),
        mono: true,
      }))}
    />
  );
}

/** 渲染可展开的配置快照。
 * @param props config 运行配置快照。
 * @returns 折叠区域。
 * @throws 不适用。
 */
export function RunSnapshot({ config }: { config: RunDetail['config'] }) {
  const { t } = useTranslation('runs');
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button
        variant="secondary"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? t('detail.snapshot.hide') : t('detail.snapshot.show')}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={cn(
            'transition-transform duration-300',
            open && 'rotate-180',
          )}
        />
      </Button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="overflow-hidden"
          >
            <pre className="mt-5 max-h-[28rem] overflow-auto rounded-2xl border border-hairline bg-black/30 p-5 font-mono text-[12px] leading-relaxed text-muted-foreground">
              {JSON.stringify(config, null, 2)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
