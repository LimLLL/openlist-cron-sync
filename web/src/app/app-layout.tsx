// 应用外壳：左侧导航（含运行中数量）、服务状态与账户菜单（主题/语言/改密/退出），窄屏收进抽屉；外壳持有活动运行与健康检查的轮询。
import { Suspense, useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Activity,
  ChevronsUpDown,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Server,
  Workflow,
  X,
} from 'lucide-react';
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../features/auth/auth-context';
import {
  useActiveRuns,
  useActiveRunsOwner,
} from '../features/runs/run-queries';
import { useHealth } from '../features/system/health-queries';
import { currentLanguage, setLanguage } from '../i18n';
import type { Language } from '../i18n';
import { PageErrorBoundary } from '../components/page-error-boundary';
import { SuspenseProgress } from '../components/top-progress';
import { Button } from '../components/ui/button';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '../components/ui/menu';
import { cn } from '../lib/utils';
import { prefetchPages } from './pages';
import { setThemePreference, useThemePreference } from './theme';
import type { ThemePreference } from './theme';

const NAV_ITEMS = [
  { key: 'overview', to: '/', icon: LayoutDashboard, end: true },
  { key: 'jobs', to: '/jobs', icon: Workflow, end: false },
  { key: 'runs', to: '/runs', icon: Activity, end: false },
  { key: 'instances', to: '/instances', icon: Server, end: false },
] as const;

/** 品牌标识。
 * @returns Logo 与产品名。
 * @throws 不适用。
 */
function Brand() {
  const { t } = useTranslation('common');
  return (
    <div className="flex h-12 items-center gap-2 px-3">
      <img src="/logo.svg" alt="" className="size-5" />
      <span className="text-sm font-semibold tracking-tight">
        {t('brand.name')}
      </span>
    </div>
  );
}

/** 渲染导航项；强制改密期间全部禁用。
 * @param props onNavigate 点击后回调（关闭抽屉）。
 * @returns 导航列表。
 * @throws 不适用。
 */
function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation('common');
  const { session } = useAuth();
  // 只读外壳已持有的活动运行缓存，不另起轮询。
  const active = useActiveRuns().data?.length ?? 0;
  const locked = Boolean(session?.mustChangePassword);
  const location = useLocation();
  // 跨运行的操作页从实例详情进入，归属“实例”分区高亮。
  const operations = location.pathname.startsWith('/operations');
  return (
    <nav aria-label={t('nav.label')} className="space-y-0.5 px-2">
      {NAV_ITEMS.map(({ key, to, icon: Icon, end }) => {
        const content = (
          <>
            <Icon size={16} aria-hidden="true" className="shrink-0" />
            <span className="flex-1 truncate">{t(`nav.${key}`)}</span>
            {key === 'runs' && active > 0 && (
              <span
                className="rounded bg-info/12 px-1.5 text-xs leading-5 font-medium text-info tabular-nums"
                title={t('nav.running', { count: active })}
              >
                {active}
              </span>
            )}
          </>
        );
        const base =
          'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors';
        if (locked)
          return (
            <span
              key={key}
              aria-disabled="true"
              className={cn(base, 'text-muted-foreground/50')}
            >
              {content}
            </span>
          );
        return (
          <NavLink
            key={key}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                base,
                isActive || (operations && key === 'instances')
                  ? 'bg-surface font-medium text-foreground shadow-xs ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-surface hover:text-foreground',
              )
            }
          >
            {content}
          </NavLink>
        );
      })}
    </nav>
  );
}

/** 服务就绪状态一行。
 * @returns 状态行。
 * @throws 不适用。
 */
function HealthLine() {
  const { t } = useTranslation('common');
  const health = useHealth();
  const state = health.isError
    ? { tone: 'bg-danger', label: t('health.unavailable') }
    : !health.data
      ? { tone: 'bg-muted-foreground', label: t('health.checking') }
      : health.data.database === 'error'
        ? { tone: 'bg-danger', label: t('health.databaseError') }
        : health.data.status === 'ok'
          ? { tone: 'bg-success', label: t('health.ok') }
          : { tone: 'bg-warning', label: t('health.notReady') };
  return (
    <p
      role="status"
      className="flex items-center gap-2 px-3 text-xs text-muted-foreground"
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-full', state.tone)}
      />
      {state.label}
    </p>
  );
}

/** 账户菜单：主题、语言、改密与退出。
 * @param props onNavigate 导航后关闭移动端抽屉。
 * @returns 菜单触发器与内容。
 * @throws 不适用。
 */
function AccountMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation('common');
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const theme = useThemePreference();
  const username = session?.username ?? '';
  // useTranslation 在切换语言时重新渲染，单选状态随之同步。
  const language = currentLanguage();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={t('layout.accountMenu')}
          className="flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-surface"
        >
          <span
            aria-hidden="true"
            className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground uppercase"
          >
            {[...username][0] ?? '?'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {username}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {t('layout.administrator')}
            </span>
          </span>
          <ChevronsUpDown
            size={14}
            aria-hidden="true"
            className="shrink-0 text-muted-foreground"
          />
        </button>
      </MenuTrigger>
      <MenuContent align="start" side="top" className="w-56">
        <MenuLabel>{t('layout.theme')}</MenuLabel>
        <MenuRadioGroup
          value={theme}
          onValueChange={(value) =>
            setThemePreference(value as ThemePreference)
          }
        >
          <MenuRadioItem value="system">
            {t('layout.themeSystem')}
          </MenuRadioItem>
          <MenuRadioItem value="light">{t('layout.themeLight')}</MenuRadioItem>
          <MenuRadioItem value="dark">{t('layout.themeDark')}</MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuLabel>{t('layout.language')}</MenuLabel>
        <MenuRadioGroup
          value={language}
          onValueChange={(value) => void setLanguage(value as Language)}
        >
          <MenuRadioItem value="zh">{t('language.zh')}</MenuRadioItem>
          <MenuRadioItem value="en">{t('language.en')}</MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem
          onSelect={() => {
            navigate('/change-password');
            onNavigate?.();
          }}
        >
          <KeyRound size={14} aria-hidden="true" />
          {t('layout.changePassword')}
        </MenuItem>
        <MenuItem onSelect={() => logout('signed-out')}>
          <LogOut size={14} aria-hidden="true" />
          {t('layout.signOut')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** 侧栏完整内容：品牌、导航、服务状态与账户。
 * @param props onNavigate 导航后回调（抽屉中用于关闭）。
 * @returns 侧栏内容。
 * @throws 不适用。
 */
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <Brand />
      <div className="mt-2 flex-1 overflow-y-auto">
        <NavItems onNavigate={onNavigate} />
      </div>
      <div className="space-y-2 border-t border-border p-2 pt-3">
        <HealthLine />
        <AccountMenu onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/** 窄屏顶部栏与导航抽屉。
 * @returns 顶部栏。
 * @throws 不适用。
 */
function MobileBar() {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur lg:hidden">
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('layout.openNav')}>
            <MenuIcon size={18} aria-hidden="true" />
          </Button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay motion-safe:animate-fade-in" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-surface-2 motion-safe:animate-slide-in-left">
            <DialogPrimitive.Title className="sr-only">
              {t('nav.label')}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              {t('nav.label')}
            </DialogPrimitive.Description>
            <SidebarContent onNavigate={() => setOpen(false)} />
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2"
                aria-label={t('layout.closeNav')}
              >
                <X size={16} aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <img src="/logo.svg" alt="" className="size-5" />
      <span className="text-sm font-semibold">{t('brand.name')}</span>
    </header>
  );
}

/** 渲染外壳与当前页面；切换路由时把焦点移到正文并回到顶部。
 * @returns 应用外壳。
 * @throws 不适用。
 */
export function AppLayout() {
  const { t } = useTranslation('common');
  const outlet = useOutlet();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  // 外壳是活动运行轮询的唯一持有者；页面只读缓存。
  useActiveRunsOwner();
  useHealth(true);

  useEffect(() => prefetchPages(), []);
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lg"
      >
        {t('layout.skip')}
      </a>
      <div className="min-h-svh lg:grid lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-svh border-r border-border bg-surface-2/60 lg:block">
          <SidebarContent />
        </aside>
        <div className="min-w-0">
          <MobileBar />
          <main
            id="main-content"
            ref={main}
            tabIndex={-1}
            className="mx-auto w-full max-w-[100rem] px-4 py-5 outline-none sm:px-6 lg:px-8 lg:py-6"
          >
            <PageErrorBoundary key={pathname}>
              <Suspense fallback={<SuspenseProgress />}>{outlet}</Suspense>
            </PageErrorBoundary>
          </main>
        </div>
      </div>
    </>
  );
}
