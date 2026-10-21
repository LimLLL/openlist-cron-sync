// 提供桌面侧栏和可访问移动抽屉，业务导航随当前交付范围保持明确状态。
import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Activity,
  ArrowUpRight,
  CircleDot,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Orbit,
  Radio,
  Server,
  Workflow,
  X,
} from 'lucide-react';
import { Link, NavLink, useLocation, useOutlet } from 'react-router';
import { useAuth } from '../features/auth/auth-context';
import { Button } from '../components/ui/button';
import { PageTransition } from '../components/page-transition';
import { cn } from '../lib/utils';

/** 显示品牌标识；所有图标均来自 Lucide。
 * @returns 品牌元素。
 * @throws 不适用。
 */
function Brand() {
  return (
    <div className="brand">
      <Orbit size={27} strokeWidth={1.4} aria-hidden="true" />
      <span>
        openlist<span className="brand-suffix"> / sync</span>
      </span>
    </div>
  );
}

/** 渲染桌面与移动端共用的导航及会话操作。
 * @param props 选择路由后关闭移动抽屉的回调。
 * @returns 侧栏内容。
 * @throws 不适用。
 */
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { session, logout } = useAuth();
  const forced = session?.mustChangePassword;
  return (
    <div className="flex h-full flex-col px-5 py-8">
      <Brand />
      <p className="eyebrow mt-14 mb-5 px-3">WORKSPACE</p>
      <nav aria-label="Main navigation" className="space-y-1.5">
        {forced ? (
          <span aria-disabled="true" className="nav-item opacity-40">
            <LayoutDashboard size={18} aria-hidden="true" />
            Dashboard
          </span>
        ) : (
          <NavLink
            to="/"
            end
            onClick={onNavigate}
            className={({ isActive }) =>
              cn('nav-item', isActive && 'nav-item-active')
            }
          >
            <LayoutDashboard size={18} aria-hidden="true" />
            Dashboard
            <span className="ml-auto font-mono text-[10px] opacity-50">01</span>
          </NavLink>
        )}
        {[
          { label: 'Instances', icon: Server },
          { label: 'Jobs', icon: Workflow },
          { label: 'Runs', icon: Activity },
          { label: 'Operations', icon: Radio },
        ].map(({ label, icon: Icon }) => (
          <span
            key={label}
            aria-disabled="true"
            className="nav-item cursor-default opacity-35"
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </span>
        ))}
      </nav>
      <div className="mt-auto pt-12">
        <div className="mb-5 rounded-xl border border-border bg-surface-raised/50 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs">
            <CircleDot size={13} className="text-accent" aria-hidden="true" />
            Private workspace
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            One administrator.
            <br />
            Your instances, in your hands.
          </p>
        </div>
        <div className="border-t border-border pt-4">
          <NavLink
            to="/change-password"
            onClick={onNavigate}
            className={({ isActive }) =>
              cn('nav-item text-xs', isActive && 'nav-item-active')
            }
          >
            <KeyRound size={16} aria-hidden="true" />
            Change password
          </NavLink>
          <button className="nav-item w-full text-xs" onClick={() => logout()}>
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

/** 渲染受保护应用框架，移动导航具有焦点管理和 Escape 关闭行为。
 * @returns 侧栏、页头和动画路由出口。
 * @throws 不适用。
 */
export function AppLayout() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const outlet = useOutlet();
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    document.title = `${location.pathname === '/change-password' ? 'Account security' : 'Workspace'} · OpenList`;
    main.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <div className="min-h-svh">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-surface lg:block">
        <SidebarContent />
      </aside>
      <div className="lg:pl-64">
        <header className="flex h-20 items-center justify-between gap-4 border-b border-border px-5 sm:px-10">
          <div className="flex items-center gap-3">
            <Dialog.Root open={open} onOpenChange={setOpen}>
              <Dialog.Trigger asChild>
                <Button
                  variant="ghost"
                  className="px-3 lg:hidden"
                  aria-label="Open navigation"
                >
                  <Menu size={20} aria-hidden="true" />
                </Button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" />
                <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-72 max-w-[90vw] border-r border-border bg-surface">
                  <Dialog.Title className="sr-only">
                    Workspace navigation
                  </Dialog.Title>
                  <Dialog.Description className="sr-only">
                    Navigate your workspace or manage your account.
                  </Dialog.Description>
                  <Dialog.Close asChild>
                    <Button
                      variant="ghost"
                      className="absolute top-4 right-2 px-3"
                      aria-label="Close navigation"
                    >
                      <X size={18} aria-hidden="true" />
                    </Button>
                  </Dialog.Close>
                  <SidebarContent onNavigate={() => setOpen(false)} />
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <p className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
              OBSERVATORY <span className="mx-2 text-border">/</span>
              <span className="text-foreground">
                {location.pathname === '/change-password'
                  ? 'ACCOUNT'
                  : 'WORKSPACE'}
              </span>
            </p>
          </div>
          <span className="flex min-w-0 items-center gap-2 text-xs">
            <span className="hidden text-muted-foreground sm:inline">
              Administrator
            </span>
            <span className="max-w-32 truncate rounded-full border border-border px-3 py-1.5">
              {session?.username}
            </span>
          </span>
        </header>
        <main
          id="main-content"
          ref={main}
          tabIndex={-1}
          className="mx-auto max-w-7xl px-5 py-8 outline-none sm:px-10 sm:py-12"
        >
          <PageTransition>{outlet}</PageTransition>
        </main>
        <footer className="mx-5 mt-12 flex flex-wrap justify-between gap-3 border-t border-border py-6 font-mono text-[10px] tracking-wider text-muted-foreground sm:mx-10">
          <span>OPENLIST CRON SYNC</span>
          <Link
            className="inline-flex items-center gap-1 hover:text-foreground"
            to="/change-password"
          >
            ACCOUNT SECURITY
            <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        </footer>
      </div>
    </div>
  );
}
