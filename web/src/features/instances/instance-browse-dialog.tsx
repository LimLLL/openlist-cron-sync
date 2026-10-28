// 目录浏览对话框：面包屑、上一级/刷新、路径跳转（可带路径密码）与分页列表；选择模式供任务表单挑选目录。
import { useEffect, useState } from 'react';
import { ArrowUp, ChevronRight, File, Folder, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TableSkeleton } from '../../components/skeleton';
import { ErrorState } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Dialog, DialogClose, DialogContent } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Pagination } from '../../components/ui/pagination';
import { TBody, TD, TH, THead, TR, Table } from '../../components/ui/table';
import { useErrorText } from '../../i18n/error-text';
import { formatBytes, formatTime } from '../../lib/format';
import { cn } from '../../lib/utils';
import { useInstanceBrowse } from './instance-queries';
import type { BrowseResult } from './instance-contract';

const PAGE_SIZE = 50;

/** 浏览对话框属性（任务表单依赖此接口，保持不变）。 */
interface BrowseDialogProps {
  /** 要浏览的实例 ID。 */
  instanceId: string;
  /** 标题中显示的实例名。 */
  instanceName: string;
  /** 是否打开。 */
  open: boolean;
  /** 打开状态变化回调。 */
  onOpenChange: (open: boolean) => void;
  /** 打开时的起始目录，默认根目录。 */
  initialPath?: string;
  /** 起始目录的路径密码。 */
  initialPassword?: string;
  /** 选择模式：选中当前目录时回调服务端规范化后的路径与路径密码。 */
  onSelect?: (path: string, password: string) => void;
}

/** 目录列表表头；加载中与加载后共用。
 * @returns 表头。
 * @throws 不适用。
 */
function BrowseTableHead() {
  const { t } = useTranslation('instances');
  return (
    <THead>
      <tr>
        <TH>{t('browse.columns.name')}</TH>
        <TH className="w-24 text-right">{t('browse.columns.size')}</TH>
        <TH className="hidden w-36 sm:table-cell">
          {t('browse.columns.modified')}
        </TH>
      </tr>
    </THead>
  );
}

/** 渲染目录浏览对话框。
 * @param props 实例、打开状态、起始目录与可选的选择回调。
 * @returns 对话框。
 * @throws 不适用；请求错误在框内显示并可重试。
 */
export function InstanceBrowseDialog({
  instanceId,
  instanceName,
  open,
  onOpenChange,
  initialPath = '/',
  initialPassword = '',
  onSelect,
}: BrowseDialogProps) {
  const { t } = useTranslation(['instances', 'common']);
  const errorText = useErrorText();
  const browse = useInstanceBrowse(instanceId);
  const { mutate, reset } = browse;
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [pathInput, setPathInput] = useState(initialPath);
  const [password, setPassword] = useState(initialPassword);
  // 最近一次成功的列表；加载下一页或下一级时继续显示（变暗），失败时隐藏。
  const [listing, setListing] = useState<BrowseResult | null>(null);
  // 只有当前目录已成功列出且没有进行中的请求时才能选择，避免选中失败或过期的路径。
  const selectable =
    !!listing &&
    !browse.isPending &&
    !browse.isError &&
    pathInput === listing.path &&
    password === (browse.variables?.password ?? '');

  /** 记录成功结果，并让面包屑与输入框显示服务端规范化后的路径。
   * @param result 浏览结果。
   * @returns 不适用。
   * @throws 不适用。
   */
  const accept = (result: BrowseResult) => {
    setListing(result);
    setCurrentPath(result.path);
    setPathInput(result.path);
  };

  // 受控打开不会触发 Radix onOpenChange：每次打开都从起始目录重新开始，丢弃上一次的浏览状态。
  useEffect(() => {
    if (!open) return;
    reset();
    setListing(null);
    setCurrentPath(initialPath);
    setPathInput(initialPath);
    setPassword(initialPassword);
    mutate(
      {
        path: initialPath,
        password: initialPassword || undefined,
        page: 1,
        pageSize: PAGE_SIZE,
      },
      {
        onSuccess: (result) => {
          setListing(result);
          setCurrentPath(result.path);
          setPathInput(result.path);
        },
      },
    );
  }, [open, instanceId, initialPath, initialPassword, mutate, reset]);

  /** 加载目录的某一页；已有请求进行中时忽略，保证响应按顺序到达。
   * @param path 目录路径。
   * @param page 页码。
   * @param refresh 是否要求 OpenList 刷新缓存。
   * @returns 不适用。
   * @throws 不适用。
   */
  const load = (path: string, page = 1, refresh = false) => {
    if (browse.isPending) return;
    setCurrentPath(path);
    setPathInput(path);
    mutate(
      {
        path,
        password: password || undefined,
        refresh,
        page,
        pageSize: PAGE_SIZE,
      },
      { onSuccess: accept },
    );
  };

  /** 进入当前目录下的子目录。
   * @param name 子目录名。
   * @returns 不适用。
   * @throws 不适用。
   */
  const enter = (name: string) => {
    const base = listing?.path ?? currentPath;
    load(base === '/' ? `/${name}` : `${base}/${name}`);
  };

  /** 返回上一级目录。
   * @returns 不适用。
   * @throws 不适用。
   */
  const up = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    load(parts.length > 0 ? `/${parts.join('/')}` : '/');
  };

  const shown = browse.isError ? null : listing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        className="h-[min(44rem,80vh)]"
        title={t('browse.title', { name: instanceName })}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span translate="no" className="font-mono">
              {currentPath}
            </span>
            {shown && (
              <>
                <span aria-hidden="true">·</span>
                <span>{t('browse.items', { count: shown.total })}</span>
                <Badge tone={shown.write ? 'success' : 'neutral'}>
                  {shown.write ? t('browse.writable') : t('browse.readOnly')}
                </Badge>
              </>
            )}
          </span>
        }
        footer={
          <>
            <DialogClose asChild>
              <Button>
                {onSelect
                  ? t('common:actions.cancel')
                  : t('common:actions.close')}
              </Button>
            </DialogClose>
            {onSelect && (
              <Button
                variant="primary"
                disabled={!selectable}
                onClick={() =>
                  selectable && listing && onSelect(listing.path, password)
                }
              >
                {t('browse.selectFolder')}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={up}
              disabled={currentPath === '/' || browse.isPending}
              aria-label={t('browse.up')}
              title={t('browse.up')}
            >
              <ArrowUp size={15} aria-hidden="true" />
            </Button>
            <Breadcrumbs
              path={currentPath}
              onNavigate={load}
              disabled={browse.isPending}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() =>
                load(currentPath, browse.variables?.page ?? 1, true)
              }
              disabled={browse.isPending}
              aria-label={t('common:actions.refresh')}
              title={t('common:actions.refresh')}
            >
              <RefreshCw
                size={14}
                aria-hidden="true"
                className={browse.isPending ? 'motion-safe:animate-spin' : ''}
              />
            </Button>
          </div>

          <form
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              load(pathInput);
            }}
          >
            <Input
              aria-label={t('browse.path')}
              className="font-mono"
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              required
            />
            <Input
              type="password"
              aria-label={t('browse.pathPassword')}
              placeholder={t('browse.pathPassword')}
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button type="submit" disabled={browse.isPending}>
              {t('browse.open')}
            </Button>
          </form>

          {browse.isError && (
            <ErrorState
              error={browse.error}
              onRetry={() => load(currentPath, browse.variables?.page ?? 1)}
            />
          )}
          {browse.isPending && !shown && (
            <TableSkeleton
              head={<BrowseTableHead />}
              columns={[
                'title',
                { kind: 'number', className: 'text-right' },
                { kind: 'time', className: 'hidden sm:table-cell' },
              ]}
              label={t('browse.loading')}
            />
          )}
          {shown && shown.items.length === 0 && (
            <p className="rounded-lg border border-dashed border-input py-10 text-center text-[13px] text-muted-foreground">
              {t('browse.empty')}
            </p>
          )}
          {shown && shown.items.length > 0 && (
            <div
              aria-busy={browse.isPending}
              className={cn(
                'transition-opacity',
                browse.isPending && 'opacity-50',
              )}
            >
              <Table aria-label={t('browse.tableLabel')}>
                <BrowseTableHead />
                <TBody>
                  {shown.items.map((item) => (
                    <TR key={item.name}>
                      <TD className="max-w-0">
                        {item.isDir ? (
                          <button
                            type="button"
                            onClick={() => enter(item.name)}
                            disabled={browse.isPending}
                            aria-label={t('browse.openItem', {
                              name: item.name,
                            })}
                            className="flex w-full min-w-0 items-center gap-2 text-left hover:underline disabled:pointer-events-none"
                          >
                            <Folder
                              size={15}
                              aria-hidden="true"
                              className="shrink-0 text-info"
                            />
                            <span className="truncate">{item.name}</span>
                            <ChevronRight
                              size={13}
                              aria-hidden="true"
                              className="ml-auto shrink-0 text-muted-foreground"
                            />
                          </button>
                        ) : (
                          <span className="flex min-w-0 items-center gap-2">
                            <File
                              size={15}
                              aria-hidden="true"
                              className="shrink-0 text-muted-foreground"
                            />
                            <span className="truncate">{item.name}</span>
                          </span>
                        )}
                      </TD>
                      <TD className="text-right text-xs text-muted-foreground">
                        {item.isDir ? '' : formatBytes(item.size)}
                      </TD>
                      <TD className="hidden text-xs text-muted-foreground sm:table-cell">
                        {formatTime(item.modified)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
          {shown && shown.total > shown.pageSize && (
            <Pagination
              page={shown.page}
              pageSize={shown.pageSize}
              total={shown.total}
              onPageChange={(next) => load(currentPath, next)}
            />
          )}
          {shown && shown.warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-warning">
              {shown.warnings.map((warning, position) => (
                <li
                  key={position}
                  title={`${warning.code} · ${warning.message}`}
                >
                  {errorText(warning.code, warning.message)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 渲染可点击的路径面包屑；最后一段为当前目录，不可点击。
 * @param props path 当前路径；onNavigate 跳转回调；disabled 加载中禁用。
 * @returns 面包屑导航。
 * @throws 不适用。
 */
function Breadcrumbs({
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
    'shrink-0 rounded px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-50';
  return (
    <nav
      aria-label={t('browse.path')}
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
    >
      <button
        type="button"
        onClick={() => onNavigate('/')}
        disabled={disabled || segments.length === 0}
        className={crumb}
      >
        {t('browse.root')}
      </button>
      {segments.map((segment, position) => {
        const target = `/${segments.slice(0, position + 1).join('/')}`;
        const last = position === segments.length - 1;
        return (
          <span key={target} className="flex shrink-0 items-center gap-0.5">
            <ChevronRight
              size={12}
              aria-hidden="true"
              className="text-muted-foreground/60"
            />
            {last ? (
              <span
                translate="no"
                aria-current="location"
                className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs"
              >
                {segment}
              </span>
            ) : (
              <button
                type="button"
                translate="no"
                onClick={() => onNavigate(target)}
                disabled={disabled}
                className={crumb}
              >
                {segment}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
