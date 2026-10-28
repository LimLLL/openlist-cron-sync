// 管理员登录页：居中表单、会话结束提示与语言切换；不保存密码，会话持久化由认证上下文负责。
import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useDocumentTitle } from '../../components/page';
import { ErrorState } from '../../components/states';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { PasswordField } from '../../components/ui/password-field';
import { Segmented } from '../../components/ui/segmented';
import { currentLanguage, setLanguage } from '../../i18n';
import type { Language } from '../../i18n';
import { useAuth } from './auth-context';
import { passwordError } from './auth-contract';
import { useAuthForm } from './use-auth-form';

/** 渲染登录页；已登录时跳转到工作区或强制改密页。
 * @returns 登录页面或重定向。
 * @throws 不适用；登录错误显示在表单内。
 */
export function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { session, notice, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { pending, error, submit } = useAuthForm();
  useDocumentTitle(t('login.title'));
  if (session)
    return (
      <Navigate
        to={session.mustChangePassword ? '/change-password' : '/'}
        replace
      />
    );

  /** 本地校验用户名与密码长度后登录。
   * @param event 表单提交事件。
   * @returns 不适用。
   * @throws 不适用。
   */
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const length = [...username].length;
    const validation =
      length < 1 || length > 64 ? 'username' : passwordError(password);
    void submit((signal) => login(username, password, signal), validation);
  };

  return (
    <main className="relative grid min-h-svh place-items-center bg-background px-4 py-12">
      <div className="absolute top-4 right-4">
        <Segmented<Language>
          label={t('login.language')}
          value={currentLanguage()}
          onChange={(language) => void setLanguage(language)}
          options={[
            { value: 'zh', label: t('common:language.zh') },
            { value: 'en', label: t('common:language.en') },
          ]}
        />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-2">
          <img src="/logo.svg" alt="" className="size-6" />
          <span className="text-sm font-semibold tracking-tight">
            {t('common:brand.name')}
          </span>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6 shadow-xs">
          <h1 className="text-lg font-semibold tracking-tight">
            {t('login.title')}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t('login.subtitle')}
          </p>
          {notice && (
            <p
              role="status"
              className="mt-4 rounded-md bg-success/10 px-3 py-2 text-[13px] text-success"
            >
              {t(`notice.${notice}`)}
            </p>
          )}
          <form
            onSubmit={handleSubmit}
            aria-label={t('login.formLabel')}
            className="mt-5 space-y-4"
          >
            <Field id="username" label={t('login.username')}>
              <Input
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus
              />
            </Field>
            <PasswordField
              id="password"
              name="password"
              label={t('login.password')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
            {error && <ErrorState error={error} />}
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={pending}
            >
              {pending ? t('login.submitting') : t('login.submit')}
            </Button>
          </form>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          {t('login.sessionNote')}
        </p>
      </div>
    </main>
  );
}
