// 提供基础工作区入口与真实账号状态，不展示未实现业务的模拟指标。
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, KeyRound, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../features/auth/auth-context';
import { parseAdministrator } from '../features/auth/auth-contract';
import { OrbitArt } from '../components/orbit-art';
import { ErrorState, LoadingState } from '../components/states';
import { Button } from '../components/ui/button';

/** 显示当前管理员身份和安全入口，实际请求经过统一认证客户端。
 * @returns 工作区首页。
 * @throws 不适用；请求错误通过共享状态组件显示。
 */
export function WorkspacePage() {
  const { session, request } = useAuth();
  const administrator = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: ({ signal }) =>
      request('/auth/me', { signal, parse: parseAdministrator }),
  });
  return (
    <section>
      <div className="workspace-hero">
        <div className="relative z-10">
          <p className="eyebrow mb-5">YOUR PRIVATE OBSERVATORY</p>
          <h1 className="page-title">
            A quieter orbit.
            <br />
            <span className="text-muted-foreground">A clearer view.</span>
          </h1>
          <p className="mt-6 max-w-sm text-sm leading-7 text-muted-foreground">
            A home for your OpenList connections.
            <br />
            Your workspace starts with you.
          </p>
        </div>
        <OrbitArt />
      </div>
      <div className="mt-8 grid gap-5 md:grid-cols-[1.3fr_1fr]">
        <article className="panel p-6 sm:p-8">
          <p className="eyebrow mb-6 flex items-center gap-2">
            <ShieldCheck size={15} aria-hidden="true" />
            ADMINISTRATOR
          </p>
          {administrator.isPending ? (
            <LoadingState label="Confirming your account…" />
          ) : administrator.isError ? (
            <ErrorState
              error={administrator.error}
              onRetry={() => {
                void administrator.refetch();
              }}
            />
          ) : (
            <>
              <h2 className="font-display text-3xl tracking-tight">
                {administrator.data.username}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                You have administrator access to this workspace.
              </p>
            </>
          )}
          <div className="mt-7 flex items-center justify-between gap-4 border-t border-border pt-5 text-xs">
            <span className="text-muted-foreground">Session ends</span>
            <time
              dateTime={
                session ? new Date(session.expiresAt).toISOString() : undefined
              }
              className="font-mono"
            >
              {session
                ? new Intl.DateTimeFormat(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZoneName: 'short',
                  }).format(session.expiresAt)
                : '—'}
            </time>
          </div>
        </article>
        <article className="panel flex flex-col items-start p-6 sm:p-8">
          <KeyRound
            size={24}
            strokeWidth={1.4}
            className="mb-6 text-accent"
            aria-hidden="true"
          />
          <h2 className="font-display text-2xl tracking-tight">
            Keep your access yours.
          </h2>
          <p className="mt-3 mb-6 text-sm leading-6 text-muted-foreground">
            Manage your administrator password. Changing it signs out every
            active session.
          </p>
          <Button asChild variant="secondary" className="mt-auto">
            <Link to="/change-password">
              Change password
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </Button>
        </article>
      </div>
    </section>
  );
}
