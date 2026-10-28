// 详情页的连接测试结果：连通与登录两项结论、确认的账号、提醒与错误；测试中显示进行中状态，结果变化会被读屏播报。
import { CircleAlert, CircleCheck, CircleX, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useErrorText } from '../../i18n/error-text';
import { cn } from '../../lib/utils';
import type { TestResult } from './instance-contract';

/** 一项结论（可以连接 / 已登录）。
 * @param props ok 结论；label 文字。
 * @returns 结论行。
 * @throws 不适用。
 */
function Signal({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? CircleCheck : CircleX;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[13px] font-medium',
        ok ? 'text-success' : 'text-danger',
      )}
    >
      <Icon size={15} aria-hidden="true" />
      {label}
    </span>
  );
}

/** 渲染连接测试结果面板。
 * @param props pending 测试进行中；result 最近一次结果。
 * @returns 带 aria-live 的面板。
 * @throws 不适用。
 */
export function InstanceTestResult({
  pending,
  result,
}: {
  pending: boolean;
  result?: TestResult;
}) {
  const { t } = useTranslation('instances');
  const errorText = useErrorText();
  const shown = pending ? undefined : result;
  const verified =
    shown && shown.reachable && shown.authenticated && !shown.error;
  return (
    <section
      aria-live="polite"
      aria-busy={pending}
      aria-label={t('test.title')}
      className="mb-4 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <h2 className="text-[13px] font-semibold">{t('test.title')}</h2>
        {pending && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <LoaderCircle
              size={14}
              aria-hidden="true"
              className="motion-safe:animate-spin"
            />
            {t('test.testing')}
          </span>
        )}
        {shown && (
          <>
            <Signal
              ok={shown.reachable}
              label={
                shown.reachable ? t('test.reachable') : t('test.unreachable')
              }
            />
            <Signal
              ok={shown.authenticated}
              label={
                shown.authenticated
                  ? t('test.authenticated')
                  : t('test.notAuthenticated')
              }
            />
          </>
        )}
      </div>

      {shown?.account && (
        <dl className="mt-3 grid gap-x-6 gap-y-1 border-t border-border pt-3 text-[13px] sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              {t('detail.username')}
            </dt>
            <dd className="truncate">{shown.account.username}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              {t('detail.basePath')}
            </dt>
            <dd translate="no" className="truncate font-mono text-[12.5px]">
              {shown.account.basePath}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              {t('detail.role')}
            </dt>
            <dd>
              {shown.account.role === 2
                ? t('role.admin', { role: shown.account.role })
                : t('role.user', { role: shown.account.role })}
            </dd>
          </div>
        </dl>
      )}

      {shown && shown.warnings.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">{t('test.warnings')}</p>
          {shown.warnings.map((warning, position) => (
            <p key={position} className="text-[13px] text-warning">
              {errorText(warning.code, warning.message)}
              <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                {warning.code}
              </span>
            </p>
          ))}
        </div>
      )}

      {shown?.error && (
        <p className="mt-3 flex gap-2 border-t border-border pt-3 text-[13px] text-danger">
          <CircleAlert
            size={15}
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          />
          <span className="min-w-0">
            {errorText(shown.error.code, shown.error.message)}
            <span className="ml-2 font-mono text-[11px] break-all text-muted-foreground">
              {shown.error.code} · {shown.error.message}
            </span>
          </span>
        </p>
      )}

      {verified && (
        <p className="mt-3 border-t border-border pt-3 text-[13px] text-success">
          {t('test.verified')}
        </p>
      )}
    </section>
  );
}
