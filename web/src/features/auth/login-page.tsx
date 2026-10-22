// 提供管理员登录及会话结束提示，不保存密码；会话持久化由认证上下文负责。
import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpRight, LoaderCircle, Orbit, ShieldCheck } from 'lucide-react';
import { Navigate } from 'react-router';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { PasswordField } from '../../components/ui/password-field';
import { ErrorState } from '../../components/states';
import { OrbitArt } from '../../components/orbit-art';
import { LanguageSwitch } from '../../components/language-switch';
import { Magnetic } from '../../components/motion/magnetic';
import { StatusDot } from '../../components/ui/status-dot';
import { useAuth } from './auth-context';
import { passwordError } from './auth-contract';
import { useAuthForm } from './use-auth-form';

const EASE = [0.16, 1, 0.3, 1] as const;

/** 渲染公开登录入口，并把已认证用户送至允许访问的页面。
 * @returns 登录表单或认证后的路由跳转。
 * @throws 不适用；请求错误显示在表单中。
 */
export function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { session, notice, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { pending, error, submit } = useAuthForm();
  if (session)
    return (
      <Navigate
        to={session.mustChangePassword ? '/change-password' : '/'}
        replace
      />
    );

  /** 校验输入后提交登录，不对用户名或密码做隐式裁剪。
   * @param event 表单提交事件。
   * @returns 不适用。
   * @throws 不适用；submit 自行处理请求错误。
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const length = [...username].length;
    const invalidPassword = passwordError(password);
    const validation = length < 1 || length > 64 ? 'username' : invalidPassword;
    void submit((signal) => login(username, password, signal), validation);
  }

  return (
    <main className="login-layout">
      <section className="login-art-panel">
        <a href="/" className="brand">
          <Orbit size={24} strokeWidth={1.4} aria-hidden="true" />
          <span>
            {t('common:brand.name')}
            <span className="brand-suffix">{t('common:brand.suffix')}</span>
          </span>
        </a>
        <div className="login-editorial">
          <motion.p
            className="eyebrow"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, ease: EASE }}
          >
            {t('login.eyebrow')}
          </motion.p>
          <h1 className="login-headline">
            <span className="reveal-line">
              <motion.span
                className="block"
                initial={{ y: '105%' }}
                animate={{ y: 0 }}
                transition={{ duration: 1.1, ease: EASE, delay: 0.1 }}
              >
                {t('login.headline1')}
              </motion.span>
            </span>
            <span className="reveal-line">
              <motion.span
                className="block serif-accent text-accent"
                initial={{ y: '105%' }}
                animate={{ y: 0 }}
                transition={{ duration: 1.1, ease: EASE, delay: 0.2 }}
              >
                {t('login.headline2')}
              </motion.span>
            </span>
          </h1>
          <motion.p
            className="mt-8 max-w-xs text-sm leading-7 text-muted-foreground"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.45 }}
          >
            {t('login.tagline')}
          </motion.p>
        </div>
        <OrbitArt />
        <div className="login-art-footer">
          <span>{t('common:brand.product')}</span>
          <span>{t('login.footerRight')}</span>
        </div>
      </section>
      <section className="login-form-panel">
        <LanguageSwitch className="absolute top-6 right-6" />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.25 }}
          className="w-full max-w-sm"
        >
          <p className="eyebrow mb-10 flex items-center gap-2">
            <ShieldCheck size={14} className="text-accent" aria-hidden="true" />
            {t('login.access')}
          </p>
          <h2 className="font-display text-4xl font-medium tracking-tight sm:text-[2.75rem]">
            {t('login.title')}
          </h2>
          <p className="mt-3 mb-10 text-sm leading-6 text-muted-foreground">
            {t('login.subtitle')}
          </p>
          {notice && (
            <p
              role="status"
              className="mb-6 flex items-center gap-2.5 rounded-2xl border border-accent/20 bg-accent/[0.05] px-4 py-3 text-sm text-accent"
            >
              <StatusDot tone="success" />
              {t(`notice.${notice}`)}
            </p>
          )}
          <form
            onSubmit={handleSubmit}
            className="space-y-5"
            aria-label={t('login.formLabel')}
          >
            <div className="space-y-2">
              <label htmlFor="username" className="field-label">
                {t('login.username')}
              </label>
              <input
                id="username"
                name="username"
                className="field-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus
              />
            </div>
            <PasswordField
              id="password"
              name="password"
              label={t('login.password')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
            {error && <ErrorState error={error} />}
            <Magnetic className="w-full pt-3" strength={0.12}>
              <Button
                type="submit"
                className="w-full justify-between pr-4 pl-6"
                disabled={pending}
              >
                {pending ? t('login.submitting') : t('login.submit')}
                {pending ? (
                  <LoaderCircle
                    className="motion-safe:animate-spin"
                    size={18}
                    aria-hidden="true"
                  />
                ) : (
                  <ArrowUpRight size={18} aria-hidden="true" />
                )}
              </Button>
            </Magnetic>
          </form>
          <p className="mt-10 border-t border-hairline pt-6 text-xs leading-6 text-muted-foreground">
            {t('login.sessionNote')}
          </p>
        </motion.div>
      </section>
    </main>
  );
}
