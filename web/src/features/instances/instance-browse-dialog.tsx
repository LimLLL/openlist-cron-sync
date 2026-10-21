// 目录浏览对话框：精致的文件浏览器——面包屑路径、跳转栏、整行可点的文件夹与跟随指针的柔光。
import { useEffect, useState } from 'react';
import type { PointerEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowUp,
  ChevronRight,
  File,
  Folder,
  HardDrive,
  RefreshCw,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { ErrorState, LoadingState } from '../../components/states';
import { Pagination } from '../../components/ui/pagination';
import { formatBytes, formatTime } from '../../lib/format';
import { useErrorText } from '../../i18n/error-text';
import { cn } from '../../lib/utils';
import { useInstanceBrowse } from './instance-queries';
import type { BrowseItem } from './instance-contract';

const PAGE_SIZE = 50;
const ROW_CLASS =
  'grid w-full grid-cols-[1.25rem_minmax(0,1fr)_5.5rem_1rem] items-center gap-4 rounded-xl px-4 py-2.5 text-left text-sm transition-colors sm:grid-cols-[1.25rem_minmax(0,1fr)_5.5rem_8.5rem_1rem] hover:[background:radial-gradient(280px_circle_at_var(--mx)_var(--my),rgb(185_237_188/0.08),transparent_65%)]';

/** 目录浏览对话框属性。 */
interface BrowseDialogProps {
  /** 实例 UUID。 */
  instanceId: string;
  /** 实例名称（显示用）。 */
  instanceName: string;
  /** 是否打开。 */
  open: boolean;
  /** 关闭回调。 */
  onOpenChange: (open: boolean) => void;
}

/** 把指针位置写入 CSS 变量，驱动行内柔光。
 * @param event 指针事件。
 * @returns 不适用。
 * @throws 不适用。
 */
function trackPointer(event: PointerEvent<HTMLElement>): void {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`);
}

/** 渲染目录浏览对话框，支持路径导航、路径密码和分页。
 * @param props 实例信息和对话框状态。
 * @returns 目录浏览对话框。
 * @throws 不适用。
 */
export function InstanceBrowseDialog({
  instanceId,
  instanceName,
  open,
  onOpenChange,
}: BrowseDialogProps) {
  const { t } = useTranslation(['instances', 'common']);
  const errorText = useErrorText();
  const [currentPath, setCurrentPath] = useState('/');
  const [page, setPage] = useState(1);
  const [password, setPassword] = useState('');
  const [pathInput, setPathInput] = useState('/');
  const browse = useInstanceBrowse(instanceId);
  const { mutate } = browse;
  const result = browse.data;

  // 父组件通过受控 open 打开对话框时不会触发 Radix onOpenChange，在这里加载根目录。
  useEffect(() => {
    if (open) mutate({ path: '/', page: 1, pageSize: PAGE_SIZE });
  }, [open, instanceId, mutate]);

  /** 加载指定路径；请求进行中时忽略，避免乱序覆盖。
   * @param path 目标路径。
   * @param browsePage 页号。
   * @param refresh 是否让上游刷新缓存。
   * @returns 不适用。
   * @throws 不适用。
   */
  function loadPath(path: string, browsePage = 1, refresh = false) {
    if (browse.isPending) return;
    setCurrentPath(path);
    setPathInput(path);
    setPage(browsePage);
    browse.mutate({
      path,
      password: password || undefined,
      refresh,
      page: browsePage,
      pageSize: PAGE_SIZE,
    });
  }

  /** 进入子目录，基于服务端返回的规范化路径拼接。
   * @param name 目录名。
   * @returns 不适用。
   * @throws 不适用。
   */
  function navigateInto(name: string) {
    const base = result?.path ?? currentPath;
    loadPath(base === '/' ? `/${name}` : `${base}/${name}`);
  }

  /** 返回上一级目录。
   * @returns 不适用。
   * @throws 不适用。
   */
  function navigateUp() {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    loadPath(parts.length > 0 ? `/${parts.join('/')}` : '/');
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content flex h-[min(46rem,calc(100svh-4rem))] max-w-2xl flex-col overflow-hidden p-0">
          <header className="flex items-start justify-between gap-4 px-7 pt-7 pb-5">
            <div className="min-w-0">
              <p className="eyebrow flex items-center gap-2">
                <HardDrive size={12} className="text-accent" aria-hidden="true" />
                {t('browse.eyebrow')}
              </p>
              <Dialog.Title className="mt-2 truncate font-display text-2xl font-medium tracking-tight">
                {instanceName}
              </Dialog.Title>
              <Dialog.Description className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{currentPath}</span>
                {result && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{t('browse.items', { count: result.total })}</span>
                    <Badge variant={result.write ? 'success' : 'default'} className="ml-1">
                      {result.write ? t('browse.writable') : t('browse.readOnly')}
                    </Badge>
                  </>
                )}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                aria-label={t('common:actions.close')}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>

          <div className="flex items-center gap-1 border-y border-hairline px-4 py-2">
            <button
              type="button"
              onClick={navigateUp}
              disabled={currentPath === '/' || browse.isPending}
              aria-label={t('browse.up')}
              title={t('browse.up')}
              className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-30"
            >
              <ArrowUp size={15} aria-hidden="true" />
            </button>
            <PathBreadcrumbs path={currentPath} onNavigate={loadPath} disabled={browse.isPending} />
            <button
              type="button"
              onClick={() => loadPath(currentPath, page, true)}
              disabled={browse.isPending}
              aria-label={t('common:actions.refresh')}
              title={t('common:actions.refresh')}
              className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-30"
            >
              <RefreshCw
                size={14}
                className={browse.isPending ? 'motion-safe:animate-spin' : ''}
                aria-hidden="true"
              />
            </button>
          </div>

          <form
            className="grid gap-2 border-b border-hairline px-6 py-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              loadPath(pathInput);
            }}
          >
            <input
              aria-label={t('browse.path')}
              className="field-input min-h-10 font-mono text-[13px]"
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              required
            />
            <input
              type="password"
              aria-label={t('browse.pathPassword')}
              placeholder={t('browse.pathPassword')}
              autoComplete="off"
              className="field-input min-h-10 text-[13px]"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button type="submit" size="sm" variant="secondary" className="min-h-10" disabled={browse.isPending}>
              {t('browse.open')}
            </Button>
          </form>

          <div
            role="table"
            aria-label={t('browse.tableLabel')}
            aria-busy={browse.isPending}
            className={cn('flex-1 overflow-y-auto px-3 py-3 transition-opacity', browse.isPending && result && 'opacity-50')}
          >
            {browse.isPending && !result && (
              <div className="px-4 py-2">
                <LoadingState label={t('browse.loading')} rows={6} />
              </div>
            )}
            {browse.isError && (
              <div className="px-3 py-2">
                <ErrorState error={browse.error} onRetry={() => loadPath(currentPath, page)} />
              </div>
            )}
            {result && result.items.length === 0 && (
              <p className="px-4 py-16 text-center serif-accent text-2xl text-muted-foreground">
                {t('browse.empty')}
              </p>
            )}
            {result && result.items.length > 0 && (
              <div role="rowgroup">
                {result.items.map((item) => (
                  <BrowseRow
                    key={item.name}
                    item={item}
                    disabled={browse.isPending}
                    onOpen={() => navigateInto(item.name)}
                  />
                ))}
              </div>
            )}
          </div>

          {result && (result.total > result.pageSize || result.warnings.length > 0) && (
            <footer className="space-y-3 border-t border-hairline px-6 py-3">
              {result.total > result.pageSize && (
                <Pagination
                  page={result.page}
                  pageSize={result.pageSize}
                  total={result.total}
                  onPageChange={(next) => loadPath(currentPath, next)}
                />
              )}
              {result.warnings.length > 0 && (
                <ul className="space-y-1 text-xs text-signal">
                  {result.warnings.map((warning, position) => (
                    <li key={position} title={`${warning.code} · ${warning.message}`}>
                      {errorText(warning.code, warning.message)}
                    </li>
                  ))}
                </ul>
              )}
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 渲染一行目录条目；文件夹整行可点击进入，文件仅展示。
 * @param props item 条目；disabled 是否禁用导航；onOpen 进入目录回调。
 * @returns 表格行。
 * @throws 不适用。
 */
function BrowseRow({ item, disabled, onOpen }: { item: BrowseItem; disabled: boolean; onOpen: () => void }) {
  const { t } = useTranslation('instances');
  const cells = (
    <>
      <span role="cell" className={item.isDir ? 'text-accent' : 'text-muted-foreground'}>
        {item.isDir ? <Folder size={16} aria-hidden="true" /> : <File size={16} aria-hidden="true" />}
      </span>
      <span role="cell" className="truncate">
        {item.name}
      </span>
      <span role="cell" className="text-right font-mono text-[11.5px] text-muted-foreground">
        {item.isDir ? '' : formatBytes(item.size)}
      </span>
      <span role="cell" className="hidden text-right font-mono text-[11.5px] text-muted-foreground sm:block">
        {formatTime(item.modified)}
      </span>
      <span role="cell" className="text-muted-foreground">
        {item.isDir && <ChevronRight size={14} aria-hidden="true" />}
      </span>
    </>
  );
  if (!item.isDir)
    return (
      <div role="row" className={ROW_CLASS} onPointerMove={trackPointer}>
        {cells}
      </div>
    );
  return (
    <button
      type="button"
      role="row"
      className={cn(ROW_CLASS, 'hover:text-foreground disabled:pointer-events-none')}
      onPointerMove={trackPointer}
      onClick={onOpen}
      disabled={disabled}
      aria-label={t('browse.openItem', { name: item.name })}
    >
      {cells}
    </button>
  );
}

/** 路径面包屑导航，最后一段为当前目录。
 * @param props 当前路径、导航回调与禁用状态。
 * @returns 面包屑组件。
 * @throws 不适用。
 */
function PathBreadcrumbs({
  path,
  onNavigate,
  disabled,
}: {
  path: string;
  onNavigate: (path: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation('instances');
  const segments = path.split('/').filter(Boolean);
  const crumb =
    'shrink-0 rounded-full px-2.5 py-1 font-mono text-[12px] transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-50';
  return (
    <nav
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-muted-foreground"
      aria-label={t('browse.path')}
    >
      <button type="button" onClick={() => onNavigate('/')} disabled={disabled} className={crumb}>
        {t('browse.root')}
      </button>
      {segments.map((segment, position) => {
        const segmentPath = `/${segments.slice(0, position + 1).join('/')}`;
        const last = position === segments.length - 1;
        return (
          <span key={segmentPath} className="flex shrink-0 items-center gap-0.5">
            <ChevronRight size={12} className="text-white/20" aria-hidden="true" />
            {last ? (
              <span className="rounded-full bg-white/[0.05] px-2.5 py-1 font-mono text-[12px] text-foreground">
                {segment}
              </span>
            ) : (
              <button type="button" onClick={() => onNavigate(segmentPath)} disabled={disabled} className={crumb}>
                {segment}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
