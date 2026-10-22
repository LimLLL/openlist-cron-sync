// 连接测试结果面板：页面上唯一的玻璃焦点元素；测试中显示扫描光带，完成后展示连通、认证、账号与提醒。
import { motion } from 'framer-motion';
import { CircleAlert, Info, ShieldCheck, Wifi } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatusDot } from '../../components/ui/status-dot';
import { useErrorText } from '../../i18n/error-text';
import { cn } from '../../lib/utils';
import type { TestResult } from './instance-contract';

const EASE = [0.16, 1, 0.3, 1] as const;

/** 渲染单个信号：图标、状态点与文字；未知时（测试中）显示为暗色。
 * @param props icon 图标；ok 结果，null 表示进行中；label 文案。
 * @returns 信号元素。
 * @throws 不适用。
 */
function Signal({
  icon: Icon,
  ok,
  label,
}: {
  icon: LucideIcon;
  ok: boolean | null;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'grid size-10 place-items-center rounded-full border',
          ok === null && 'border-hairline text-muted-foreground',
          ok === true && 'border-accent/30 bg-accent/[0.07] text-accent',
          ok === false && 'border-danger/30 bg-danger/[0.07] text-danger',
        )}
      >
        <Icon size={17} aria-hidden="true" />
      </span>
      <span className="flex items-center gap-2 text-sm">
        {ok !== null && <StatusDot tone={ok ? 'success' : 'danger'} />}
        <span className={ok === null ? 'text-muted-foreground' : undefined}>
          {label}
        </span>
      </span>
    </div>
  );
}

/** 渲染连接测试面板。
 * @param props pending 是否测试中；result 最近一次测试结果。
 * @returns 测试面板。
 * @throws 不适用。
 */
export function InstanceTestPanel({
  pending,
  result,
}: {
  pending: boolean;
  result?: TestResult;
}) {
  const { t } = useTranslation('instances');
  const errorText = useErrorText();
  const shown = pending ? undefined : result;

  return (
    <motion.section
      aria-live="polite"
      aria-busy={pending}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.6, ease: EASE }}
      className="panel relative mt-8 overflow-hidden p-6 sm:p-7"
    >
      {pending && (
        // 扫描光带：测试期间从左到右循环扫过面板。
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-accent/[0.08] to-transparent"
          initial={{ x: '-100%' }}
          animate={{ x: '400%' }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <p className="eyebrow">{t('test.title')}</p>
      <div className="mt-5 flex flex-wrap gap-x-10 gap-y-4">
        <Signal
          icon={Wifi}
          ok={shown ? shown.reachable : null}
          label={
            shown
              ? shown.reachable
                ? t('test.reachable')
                : t('test.unreachable')
              : t('detail.testing')
          }
        />
        <Signal
          icon={ShieldCheck}
          ok={shown ? shown.authenticated : null}
          label={
            shown
              ? shown.authenticated
                ? t('test.authenticated')
                : t('test.notAuthenticated')
              : t('detail.testing')
          }
        />
      </div>

      {shown?.account && (
        <dl className="mt-6 grid gap-x-8 gap-y-3 border-t border-hairline pt-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="eyebrow">{t('detail.username')}</dt>
            <dd className="mt-1.5">{shown.account.username}</dd>
          </div>
          <div>
            <dt className="eyebrow">{t('detail.basePath')}</dt>
            <dd className="mt-1.5 font-mono text-[13px]">
              {shown.account.basePath}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">{t('detail.role')}</dt>
            <dd className="mt-1.5">
              {shown.account.role === 2
                ? t('role.admin', { role: shown.account.role })
                : t('role.user', { role: shown.account.role })}
            </dd>
          </div>
        </dl>
      )}

      {shown && shown.warnings.length > 0 && (
        <div className="mt-6 space-y-2 border-t border-hairline pt-5">
          <p className="eyebrow">{t('test.warnings')}</p>
          {shown.warnings.map((warning, position) => (
            <div key={position} className="flex gap-3 text-[13px]">
              <Info
                size={15}
                className="mt-0.5 shrink-0 text-signal"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p>{errorText(warning.code, warning.message)}</p>
                <p className="mt-0.5 font-mono text-[11px] break-all text-muted-foreground">
                  {warning.code} · {warning.message}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {shown?.error && (
        <div className="mt-6 flex gap-3 border-t border-hairline pt-5 text-[13px]">
          <CircleAlert
            size={15}
            className="mt-0.5 shrink-0 text-danger"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-danger">
              {errorText(shown.error.code, shown.error.message)}
            </p>
            <p className="mt-0.5 font-mono text-[11px] break-all text-muted-foreground">
              {shown.error.code} · {shown.error.message}
            </p>
          </div>
        </div>
      )}

      {shown && shown.reachable && shown.authenticated && !shown.error && (
        <p className="mt-6 border-t border-hairline pt-5 text-[13px] text-accent">
          {t('test.verified')}
        </p>
      )}
    </motion.section>
  );
}
