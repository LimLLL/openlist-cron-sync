// 应用外壳：毛玻璃侧栏与固定顶栏（面包屑/紧凑标题、页面主操作、语言、账户菜单），页面在其下切换。
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import {
  Activity,
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
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../features/auth/auth-context';
import { LanguageSwitch } from '../components/language-switch';
import { PageTransition } from '../components/page-transition';
import { PageErrorBoundary } from '../components/page-error-boundary';
import { SuspenseProgress } from '../components/top-progress';
import { prefetchPages } from './pages';
import { ShellContext } from './shell-context';

const NAV_ITEMS = [
  { key: 'dashboard', icon: LayoutDashboard, to: '/', num: '01' },
  { key: 'instances', icon: Server, to: '/instances', num: '02' },
  { key: 'jobs', icon: Workflow, to: '/jobs', num: '03' },
  { key: 'runs', icon: Activity, to: '/runs', num: '04' },
  { key: 'operations', icon: Radio, to: '/operations', num: '05' },
] as const;

const SPRING = { type: 'spring', stiffness: 420, damping: 36 } as const;
const EASE = [0.16, 1, 0.3, 1] as const;

/** 页面所属的导航分区。 */
type Section = (typeof NAV_ITEMS)[number]['key'] | 'account';

/** 根据路径判断当前分区，用于标题和面包屑。
 * @param pathname 当前路由路径。
 * @returns 分区键。
 * @throws 不适用。
 */
function sectionOf(pathname: string): Section {
  if (pathname === '/change-password') return 'account';
  const match = NAV_ITEMS.find(
    (item) => item.to !== '/' && pathname.startsWith(item.to),
  );
  return match?.key ?? 'dashboard';
}

/** 渲染侧栏内容：品牌、带滑动指示条的导航与产品署名。
 * @param props group 布局动画分组（桌面与抽屉各自独立）；onNavigate 选择后关闭抽屉。
 * @returns 侧栏内容。
 * @throws 不适用。
 */
function RailContent({ group, onNavigate }: { group: string; onNavigate?: () => void }) {
  const { t } = useTranslation('common');
  const { session } = useAuth();
  const forced = session?.mustChangePassword;
  return (
    <LayoutGroup id={group}>
      <div className="brand px-2">
        <Orbit size={24} strokeWidth={1.4} aria-hidden="true" />
        <span>
          {t('brand.name')}
          <span className="brand-suffix">{t('brand.suffix')}</span>
        </span>
      </div>
      <p className="eyebrow mt-12 mb-4 px-3">{t('nav.section')}</p>
      <nav aria-label={t('nav.label')} className="space-y-1">
        {NAV_ITEMS.map(({ key, icon: Icon, to, num }) =>
          // 强制改密期间只允许访问改密页。
          forced ? (
            <span key={key} aria-disabled="true" className="nav-link opacity-40">
              <span className="nav-link-number">{num}</span>
              <Icon size={16} aria-hidden="true" />
              <span className="nav-link-label">{t(`nav.${key}`)}</span>
            </span>
          ) : (
            <NavLink key={key} to={to} end={to === '/'} onClick={onNavigate} className="nav-link">
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span layoutId="nav-indicator" className="nav-indicator" transition={SPRING} />
                  )}
                  <span className="nav-link-number">{num}</span>
                  <Icon size={16} aria-hidden="true" />
                  <span className="nav-link-label">{t(`nav.${key}`)}</span>
                </>
              )}
            </NavLink>
          ),
        )}
      </nav>
      <p className="mt-auto px-3 font-mono text-[9.5px] tracking-[0.18em] text-muted-foreground/70">
        {t('brand.product')}
      </p>
    </LayoutGroup>
  );
}

/** 渲染顶栏右侧的账户菜单：显示管理员，提供改密与退出。
 * @returns 下拉菜单。
 * @throws 不适用。
 */
function AccountMenu() {
  const { t } = useTranslation('common');
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const username = session?.username ?? '';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t('layout.accountMenu')}
          className="flex items-center gap-2 rounded-full border border-hairline bg-white/[0.03] py-1 pr-1 pl-1 text-xs transition-colors hover:border-white/20 hover:bg-white/[0.06] sm:pr-3"
        >
          <span className="grid size-7 place-items-center rounded-full bg-accent/15 font-mono text-[11px] text-accent uppercase">
            {[...username][0] ?? '·'}
          </span>
          <span className="hidden max-w-28 truncate sm:inline">{username}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={10} className="menu-surface">
          <DropdownMenu.Label className="px-3 pt-1.5 pb-2">
            <p className="eyebrow">{t('layout.administrator')}</p>
            <p className="mt-1 truncate text-sm">{username}</p>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-hairline" />
          <DropdownMenu.Item className="menu-item" onSelect={() => void navigate('/change-password')}>
            <KeyRound size={15} aria-hidden="true" />
            {t('layout.changePassword')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={() => logout()}>
            <LogOut size={15} aria-hidden="true" />
            {t('layout.signOut')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** 渲染受保护应用框架；页面通过 ShellContext 把主操作放进顶栏。
 * @returns 侧栏、顶栏和动画路由出口。
 * @throws 不适用。
 */
export function AppLayout() {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [compactTitle, setCompactTitle] = useState<string | null>(null);
  const location = useLocation();
  const outlet = useOutlet();
  const main = useRef<HTMLElement>(null);
  const section = sectionOf(location.pathname);
  const sectionLabel = t(section === 'account' ? 'nav.account' : `nav.${section}`);
  const shell = useMemo(() => ({ actionsSlot, setCompactTitle }), [actionsSlot]);

  useEffect(() => prefetchPages(), []);
  useEffect(() => {
    document.title = `${sectionLabel} · OpenList`;
  }, [sectionLabel]);
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <ShellContext.Provider value={shell}>
      <div className="relative z-10 min-h-svh">
        <a className="skip-link" href="#main-content">
          {t('layout.skip')}
        </a>
        <aside className="app-rail hidden lg:flex">
          <RailContent group="rail" />
        </aside>
        <div className="lg:pl-60">
          <header className="app-topbar">
            <div className="flex min-w-0 items-center gap-2">
              <Dialog.Root open={open} onOpenChange={setOpen}>
                <Dialog.Trigger asChild>
                  <button
                    type="button"
                    className="-ml-2 grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground lg:hidden"
                    aria-label={t('layout.openNav')}
                  >
                    <Menu size={19} aria-hidden="true" />
                  </button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="dialog-overlay" />
                  <Dialog.Content className="app-rail drawer z-50 flex w-72 max-w-[85vw]">
                    <Dialog.Title className="sr-only">{t('layout.navTitle')}</Dialog.Title>
                    <Dialog.Description className="sr-only">{t('layout.navDescription')}</Dialog.Description>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="absolute top-5 right-3 grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
                        aria-label={t('layout.closeNav')}
                      >
                        <X size={17} aria-hidden="true" />
                      </button>
                    </Dialog.Close>
                    <RailContent group="drawer" onNavigate={() => setOpen(false)} />
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
              {/* 面包屑与紧凑标题在同一位置上下交替，标题滚出视口后由这里接替。 */}
              <div className="relative h-6 min-w-0 overflow-hidden">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.p
                    key={compactTitle ?? 'crumb'}
                    className={compactTitle ? 'topbar-title truncate leading-6' : 'topbar-crumb leading-6'}
                    initial={{ y: '100%', opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: '-100%', opacity: 0 }}
                    transition={{ duration: 0.45, ease: EASE }}
                  >
                    {compactTitle ?? (
                      <>
                        {t('layout.observatory')}
                        <span className="mx-2 text-white/20">/</span>
                        <span className="text-foreground">{sectionLabel}</span>
                      </>
                    )}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <div ref={setActionsSlot} className="flex items-center gap-2" />
              <span className="hidden h-5 w-px bg-hairline sm:block" aria-hidden="true" />
              <LanguageSwitch />
              <AccountMenu />
            </div>
          </header>
          <main
            id="main-content"
            ref={main}
            tabIndex={-1}
            className="relative mx-auto max-w-[88rem] px-5 pt-10 pb-28 outline-none sm:px-9 lg:px-14 lg:pt-14"
          >
            <PageTransition>
              <PageErrorBoundary key={location.pathname}>
                {/* 页面分片加载时侧栏和顶栏保持不动，只由顶部进度条提示。 */}
                <Suspense fallback={<SuspenseProgress />}>{outlet}</Suspense>
              </PageErrorBoundary>
            </PageTransition>
          </main>
        </div>
      </div>
    </ShellContext.Provider>
  );
}
