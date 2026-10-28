// 任务“更多操作”菜单：试运行、编辑、启停定时、查看运行记录与归档确认；列表行与详情页共用。
import { useState } from 'react';
import {
  Archive,
  FlaskConical,
  History,
  MoreHorizontal,
  Pencil,
  Power,
  PowerOff,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '../../components/ui/menu';
import { toast } from '../../components/ui/toast';
import { useErrorText } from '../../i18n/error-text';
import { ApiError } from '../../lib/api-client';
import { useArchiveJob, useToggleJob } from './job-queries';
import type { JobView } from './job-contract';

/** 菜单属性。 */
interface JobActionsMenuProps {
  /** 任务。 */
  job: Pick<JobView, 'id' | 'name' | 'cron' | 'enabled' | 'archivedAt'>;
  /** 是否有进行中的运行；进行中禁用试运行、编辑与归档（后端同样会拒绝）。 */
  busy: boolean;
  /** 打开预选试运行的运行对话框。 */
  onDryRun: () => void;
  /** 是否显示“编辑”与“查看运行记录”（详情页已有对应入口时隐藏）。 */
  showNavigation?: boolean;
  /** 归档成功后的回调，例如详情页返回列表。 */
  onArchived?: () => void;
}

/** 把请求错误转换为可读文案。
 * @param error 错误。
 * @param errorText 错误码本地化函数。
 * @returns 文案。
 * @throws 不适用。
 */
function describe(
  error: Error,
  errorText: ReturnType<typeof useErrorText>,
): string {
  return error instanceof ApiError
    ? errorText(error.code, error.message)
    : error.message;
}

/** 渲染“更多操作”按钮、菜单与归档确认框。
 * @param props 任务、运行状态与回调。
 * @returns 菜单。
 * @throws 不适用；失败通过提示条或确认框内错误显示。
 */
export function JobActionsMenu({
  job,
  busy,
  onDryRun,
  showNavigation = true,
  onArchived,
}: JobActionsMenuProps) {
  const { t } = useTranslation(['jobs', 'common']);
  const navigate = useNavigate();
  const errorText = useErrorText();
  const toggle = useToggleJob();
  const archive = useArchiveJob();
  const [confirming, setConfirming] = useState(false);
  const archived = job.archivedAt !== null;

  /** 切换定时，结果用提示条反馈。
   * @returns 不适用。
   * @throws 不适用。
   */
  const toggleSchedule = () => {
    const enable = !job.enabled;
    toggle.mutate(
      { id: job.id, enable },
      {
        onSuccess: () =>
          toast({
            title: t(enable ? 'actions.enabled' : 'actions.disabled', {
              name: job.name,
            }),
          }),
        onError: (error) =>
          toast({
            tone: 'danger',
            title: t('actions.toggleFailed', { name: job.name }),
            description: describe(error, errorText),
          }),
      },
    );
  };

  /** 确认后归档任务。
   * @returns 不适用。
   * @throws 不适用。
   */
  const confirmArchive = () => {
    archive.mutate(job.id, {
      onSuccess: () => {
        setConfirming(false);
        toast({ title: t('actions.archived', { name: job.name }) });
        onArchived?.();
      },
    });
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('common:actions.more')}
            title={t('common:actions.more')}
          >
            <MoreHorizontal size={15} aria-hidden="true" />
          </Button>
        </MenuTrigger>
        <MenuContent className="w-48">
          <MenuItem disabled={busy || archived} onSelect={onDryRun}>
            <FlaskConical size={14} aria-hidden="true" />
            {t('actions.dryRun')}
          </MenuItem>
          {showNavigation && (
            <MenuItem
              disabled={busy || archived}
              onSelect={() => navigate(`/jobs/${job.id}/edit`)}
            >
              <Pencil size={14} aria-hidden="true" />
              {t('actions.edit')}
            </MenuItem>
          )}
          {job.cron && !archived && (
            <MenuItem disabled={toggle.isPending} onSelect={toggleSchedule}>
              {job.enabled ? (
                <PowerOff size={14} aria-hidden="true" />
              ) : (
                <Power size={14} aria-hidden="true" />
              )}
              {job.enabled ? t('actions.disable') : t('actions.enable')}
            </MenuItem>
          )}
          {showNavigation && (
            <MenuItem onSelect={() => navigate(`/runs?jobId=${job.id}`)}>
              <History size={14} aria-hidden="true" />
              {t('actions.viewRuns')}
            </MenuItem>
          )}
          {!archived && (
            <>
              <MenuSeparator />
              <MenuItem
                danger
                disabled={busy}
                onSelect={() => {
                  archive.reset();
                  setConfirming(true);
                }}
              >
                <Archive size={14} aria-hidden="true" />
                {t('actions.archive')}
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('actions.archiveTitle')}
        description={
          <Trans
            t={t}
            i18nKey="actions.archiveDescription"
            values={{ name: job.name }}
            components={{ strong: <strong className="text-foreground" /> }}
          />
        }
        confirmLabel={t('actions.archiveConfirm')}
        onConfirm={confirmArchive}
        pending={archive.isPending}
        error={archive.error}
      />
    </>
  );
}
