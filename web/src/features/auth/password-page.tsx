// 修改密码：支持首次强制改密与主动改密，成功后所有会话结束，需要用新密码重新登录。
import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader, useDocumentTitle } from '../../components/page';
import { ErrorState } from '../../components/states';
import { Button } from '../../components/ui/button';
import { PasswordField } from '../../components/ui/password-field';
import { useAuth } from './auth-context';
import { passwordError } from './auth-contract';
import { useAuthForm } from './use-auth-form';

/** 渲染修改密码页面。
 * @returns 改密页面。
 * @throws 不适用；错误显示在表单内。
 */
export function PasswordPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { session, changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const { pending, error, submit } = useAuthForm();
  const forced = Boolean(session?.mustChangePassword);
  useDocumentTitle(t('password.title'));

  /** 校验长度与两次输入一致后提交；成功时认证上下文会退出并提示重新登录。
   * @param event 表单提交事件。
   * @returns 不适用。
   * @throws 不适用。
   */
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
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
  };

  return (
    <>
      <PageHeader
        back={forced ? undefined : { to: '/', label: t('common:nav.overview') }}
        title={t('password.title')}
        description={
          forced ? t('password.forcedDescription') : t('password.description')
        }
      />
      <form
        onSubmit={handleSubmit}
        aria-label={t('password.formLabel')}
        className="max-w-md space-y-4 rounded-lg border border-border bg-surface p-5"
      >
        <p className="text-[13px] text-muted-foreground">
          {t('password.sessionsEnd')}
        </p>
        {/* 供密码管理器关联账号，不可见也不可编辑。 */}
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
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? t('password.submitting') : t('password.submit')}
          </Button>
        </div>
      </form>
    </>
  );
}
