// 提供管理员登录及会话结束提示，不保存密码或令牌。
import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpRight, LoaderCircle, Orbit, ShieldCheck } from 'lucide-react';
import { Navigate } from 'react-router';
import { motion } from 'framer-motion';
import { Button } from '../../components/ui/button';
import { PasswordField } from '../../components/ui/password-field';
import { ErrorState } from '../../components/states';
import { OrbitArt } from '../../components/orbit-art';
import { useAuth } from './auth-context';
import { passwordError } from './auth-contract';
import { useAuthForm } from './use-auth-form';

/** 渲染公开登录入口，并把已认证用户送至允许访问的页面。
 * @returns 登录表单或认证后的路由跳转。
 * @throws 不适用；请求错误显示在表单中。
 */
export function LoginPage() {
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
  const message =
    notice === 'password-changed'
      ? 'Password updated. Sign in with your new password.'
      : notice === 'expired'
        ? 'Your session has ended. Sign in to continue.'
        : notice === 'signed-out'
          ? 'You have been signed out.'
          : null;

  /** 校验输入后提交登录，不对用户名或密码做隐式裁剪。
   * @param event 表单提交事件。
   * @returns 不适用。
   * @throws 不适用；submit 自行处理请求错误。
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const length = [...username].length;
    const validation =
      length < 1 || length > 64
        ? 'Enter a username of 1–64 characters.'
        : passwordError(password);
    void submit((signal) => login(username, password, signal), validation);
  }

  return (
    <main className="login-layout">
      <section className="login-art-panel">
        <a href="/" className="brand">
          <Orbit size={26} strokeWidth={1.4} aria-hidden="true" />
          <span>
            openlist<span className="brand-suffix"> / sync</span>
          </span>
        </a>
        <div className="login-editorial">
          <p className="eyebrow">THE SYNCHRONIZATION OBSERVATORY</p>
          <h1>
            Everything.
            <br />
            <span className="text-accent">In orbit.</span>
          </h1>
          <p className="mt-6 max-w-xs text-sm leading-7 text-muted-foreground">
            A considered space for the files that move between your worlds.
          </p>
        </div>
        <OrbitArt />
        <div className="login-art-footer">
          <span>OPENLIST CRON SYNC</span>
          <span>PRIVATE CONSOLE</span>
        </div>
      </section>
      <section className="flex min-h-svh items-center justify-center px-6 py-12 sm:px-12">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="w-full max-w-sm"
        >
          <p className="eyebrow mb-8 flex items-center gap-2">
            <ShieldCheck size={15} aria-hidden="true" />
            ADMINISTRATOR ACCESS
          </p>
          <h2 className="font-display text-4xl tracking-tight sm:text-5xl">
            Welcome back.
          </h2>
          <p className="mt-3 mb-9 text-sm leading-6 text-muted-foreground">
            Sign in to your synchronization workspace.
          </p>
          {message && (
            <p
              role="status"
              className="mb-6 rounded-xl border border-accent/20 bg-accent/5 p-4 text-sm text-accent"
            >
              {message}
            </p>
          )}
          <form
            onSubmit={handleSubmit}
            className="space-y-6"
            aria-label="Administrator login"
          >
            <div className="space-y-2">
              <label htmlFor="username" className="field-label">
                Username
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
              label="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
            {error && <ErrorState error={error} />}
            <Button
              type="submit"
              className="w-full justify-between"
              disabled={pending}
            >
              {pending ? 'Signing in…' : 'Enter workspace'}
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
          </form>
          <p className="mt-8 border-t border-border pt-6 text-xs leading-6 text-muted-foreground">
            Your session stays in this tab’s memory. Refreshing the page
            requires you to sign in again.
          </p>
        </motion.div>
      </section>
    </main>
  );
}
