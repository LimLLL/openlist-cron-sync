// 支持首次强制改密与主动改密，成功后要求使用新密码重新登录。
import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from './auth-context';
import { passwordError } from './auth-contract';
import { useAuthForm } from './use-auth-form';
import { Button } from '../../components/ui/button';
import { PasswordField } from '../../components/ui/password-field';
import { ErrorState } from '../../components/states';
import { PageHeader } from '../../components/page-header';

/** 渲染改密表单，强制改密时不提供绕过入口。
 * @returns 密码修改页面。
 * @throws 不适用；网络和校验错误显示在表单中。
 */
export function PasswordPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { session, changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const { pending, error, submit } = useAuthForm();
  const forced = session?.mustChangePassword;

  /** 验证新旧密码和重复输入后提交请求。
   * @param event 表单事件。
   * @returns 不适用。
   * @throws 不适用；submit 统一捕获认证错误。
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const invalid = passwordError(current) ?? passwordError(password);
    const validation = invalid
      ? invalid
      : password !== confirmation
        ? 'mismatch'
        : null;
    void submit(
      (signal) => changePassword(current, password, signal),
      validation,
    );
  }

  return (
    <section>
      <PageHeader
        index="00"
        kicker={t('password.eyebrow')}
        title={forced ? t('password.forcedTitle') : t('password.title')}
        accent={forced ? t('password.forcedAccent') : t('password.accent')}
        description={
          <>
            {forced ? t('password.forcedDescription') : t('password.description')}{' '}
            {t('password.sessionsEnd')}
          </>
        }
      />
      <form
        className="panel max-w-xl space-y-6 p-6 sm:p-9"
        onSubmit={handleSubmit}
        aria-label={t('password.formLabel')}
      >
        <input
          type="text"
          name="username"
          value={session?.username ?? ''}
          autoComplete="username"
          readOnly
          hidden
        />
        <PasswordField
          id="current-password"
          name="currentPassword"
          label={t('password.currentLabel')}
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
        />
        <PasswordField
          id="new-password"
          name="newPassword"
          label={t('password.nextLabel')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          hint={t('password.nextHint')}
        />
        <PasswordField
          id="confirm-password"
          name="confirmation"
          label={t('password.confirmLabel')}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="new-password"
        />
        {error && <ErrorState error={error} />}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-6">
          {!forced && (
            <Button asChild variant="ghost">
              <Link to="/">
                <ArrowLeft size={16} aria-hidden="true" />
                {t('common:actions.back')}
              </Link>
            </Button>
          )}
          <Button type="submit" className="ml-auto" disabled={pending}>
            {pending ? t('password.submitting') : t('password.submit')}
            {pending ? (
              <LoaderCircle
                size={17}
                className="motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : (
              <ArrowUpRight size={17} aria-hidden="true" />
            )}
          </Button>
        </div>
      </form>
    </section>
  );
}
