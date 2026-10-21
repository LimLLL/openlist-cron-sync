// 支持首次强制改密与主动改密，成功后要求使用新密码重新登录。
import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, KeyRound, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from './auth-context';
import { passwordError } from './auth-contract';
import { useAuthForm } from './use-auth-form';
import { Button } from '../../components/ui/button';
import { PasswordField } from '../../components/ui/password-field';
import { ErrorState } from '../../components/states';

/** 渲染改密表单，强制改密时不提供绕过入口。
 * @returns 密码修改页面。
 * @throws 不适用；网络和校验错误显示在表单中。
 */
export function PasswordPage() {
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
    const validation =
      passwordError(current) ||
      passwordError(password) ||
      (password !== confirmation ? 'The new passwords do not match.' : null);
    void submit(
      (signal) => changePassword(current, password, signal),
      validation,
    );
  }

  return (
    <section className="mx-auto max-w-2xl py-4 sm:py-10">
      <p className="eyebrow mb-4 flex items-center gap-2">
        <KeyRound size={15} aria-hidden="true" />
        ACCOUNT SECURITY
      </p>
      <h1 className="page-title">
        {forced ? 'Make it your own.' : 'A fresh set of keys.'}
      </h1>
      <p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground">
        {forced
          ? 'Replace your initial password before entering the workspace.'
          : 'Change the password for your administrator account.'}{' '}
        All existing sessions will end after this change.
      </p>
      <form
        className="panel mt-8 space-y-6 p-6 sm:p-8"
        onSubmit={handleSubmit}
        aria-label="Change password"
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
          label="Current password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
        />
        <PasswordField
          id="new-password"
          name="newPassword"
          label="New password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          hint="12–128 characters. Use a unique password for this console."
        />
        <PasswordField
          id="confirm-password"
          name="confirmation"
          label="Confirm new password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="new-password"
        />
        {error && <ErrorState error={error} />}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
          {!forced && (
            <Button asChild variant="ghost">
              <Link to="/">
                <ArrowLeft size={16} aria-hidden="true" />
                Back
              </Link>
            </Button>
          )}
          <Button type="submit" className="ml-auto" disabled={pending}>
            {pending ? 'Updating password…' : 'Update password'}
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
