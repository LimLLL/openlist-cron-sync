// 实例列表与详情共用的展示与操作：登录方式文案、任务引用统计、带提示条的连接测试，以及归档确认框。
import { useCallback } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ui/dialog';
import { toast } from '../../components/ui/toast';
import { useErrorText } from '../../i18n/error-text';
import { ApiError } from '../../lib/api-client';
import type { JobListItem } from '../jobs/job-contract';
import { useArchiveInstance, useInstanceTest } from './instance-queries';
import type { Instance } from './instance-contract';

/** 实例在任务中的角色。 */
export type InstanceRole = 'source' | 'target' | 'both';

/** 返回登录方式的显示文字，例如“令牌”或“密码 · admin”。
 * @returns 根据实例生成文字的函数。
 * @throws 不适用。
 */
export function useAuthLabel(): (instance: Pick<Instance, 'auth'>) => string {
  const { t } = useTranslation('instances');
  return useCallback(
    (instance) =>
      instance.auth.mode === 'token'
        ? t('auth.token')
        : instance.auth.username
          ? t('auth.passwordUser', { username: instance.auth.username })
          : t('auth.password'),
    [t],
  );
}

/** 列出使用某实例的未归档任务及其角色（源、目标或两者）。
 * @param jobs 任务目录。
 * @param instanceId 实例 ID。
 * @returns 任务与角色，保持目录顺序。
 * @throws 不适用。
 */
export function instanceUsage(
  jobs: readonly JobListItem[],
  instanceId: string,
): Array<{ job: JobListItem; role: InstanceRole }> {
  const usage: Array<{ job: JobListItem; role: InstanceRole }> = [];
  for (const job of jobs) {
    if (job.archivedAt) continue;
    const source = job.source.instanceId === instanceId;
    const target = job.targets.some(
      (current) => current.instanceId === instanceId,
    );
    if (source || target)
      usage.push({
        job,
        role: source && target ? 'both' : source ? 'source' : 'target',
      });
  }
  return usage;
}

/** 统计每个实例被多少个未归档任务使用（同一任务只计一次）。
 * @param jobs 任务目录。
 * @returns 实例 ID 到任务数的映射。
 * @throws 不适用。
 */
export function usageCounts(jobs: readonly JobListItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    if (job.archivedAt) continue;
    const ids = new Set([
      job.source.instanceId,
      ...job.targets.map((target) => target.instanceId),
    ]);
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** 列表行内的连接测试：结果用提示条反馈；被封锁的实例自动请求重新认证。
 * @returns 测试变更对象，以及对某个实例发起测试的函数。
 * @throws 不适用；错误转为失败提示条。
 */
export function useConnectionTest() {
  const { t } = useTranslation('instances');
  const errorText = useErrorText();
  const test = useInstanceTest();
  const { mutate } = test;

  /** 测试指定实例并以提示条报告连通与登录结果。
   * @param instance 目标实例。
   * @returns 不适用。
   * @throws 不适用。
   */
  const run = useCallback(
    (instance: Pick<Instance, 'id' | 'name' | 'authState'>) => {
      mutate(
        { id: instance.id, retryAuth: instance.authState === 'auth_blocked' },
        {
          onSuccess: (result) => {
            if (result.reachable && result.authenticated && !result.error) {
              toast({
                title: t('testToast.ok', { name: instance.name }),
                description: result.warnings.length
                  ? result.warnings
                      .map((warning) =>
                        errorText(warning.code, warning.message),
                      )
                      .join(' · ')
                  : undefined,
              });
              return;
            }
            toast({
              tone: 'danger',
              title: !result.reachable
                ? t('testToast.unreachable', { name: instance.name })
                : !result.authenticated
                  ? t('testToast.notAuthenticated', { name: instance.name })
                  : t('testToast.failed', { name: instance.name }),
              description: result.error
                ? errorText(result.error.code, result.error.message)
                : undefined,
            });
          },
          onError: (error) =>
            toast({
              tone: 'danger',
              title: t('testToast.failed', { name: instance.name }),
              description:
                error instanceof ApiError
                  ? errorText(error.code, error.message)
                  : error.message,
            }),
        },
      );
    },
    [errorText, mutate, t],
  );

  return { test, run };
}

/** 归档确认框属性。 */
interface ArchiveInstanceDialogProps {
  /** 待归档实例；为 null 时关闭。 */
  instance: Pick<Instance, 'id' | 'name'> | null;
  /** 关闭回调。 */
  onClose: () => void;
  /** 归档成功后回调（在关闭之后调用）。 */
  onArchived?: () => void;
}

/** 渲染实例归档确认框；仍被任务使用时后端返回 409，错误显示在框内。
 * @param props 实例、关闭与成功回调。
 * @returns 确认框。
 * @throws 不适用。
 */
export function ArchiveInstanceDialog({
  instance,
  onClose,
  onArchived,
}: ArchiveInstanceDialogProps) {
  const { t } = useTranslation('instances');
  const archive = useArchiveInstance();
  return (
    <ConfirmDialog
      open={instance !== null}
      onOpenChange={(open) => {
        if (open) return;
        archive.reset();
        onClose();
      }}
      title={t('archive.title')}
      description={
        instance && (
          <Trans
            t={t}
            i18nKey="archive.description"
            values={{ name: instance.name }}
            components={{ strong: <strong className="text-foreground" /> }}
          />
        )
      }
      confirmLabel={t('archive.confirm')}
      pending={archive.isPending}
      error={archive.error}
      onConfirm={() => {
        if (!instance) return;
        archive.mutate(instance.id, {
          onSuccess: () => {
            archive.reset();
            onClose();
            toast({ title: t('archive.done', { name: instance.name }) });
            onArchived?.();
          },
        });
      }}
    />
  );
}
