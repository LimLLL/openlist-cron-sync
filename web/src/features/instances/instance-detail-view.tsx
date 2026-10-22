// 实例只读详情：关键事实条、实时测试结果、最近错误，以及账号、配额、时间线三个编辑式分节。
import type { UseMutationResult } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CountUp } from '../../components/motion/count-up';
import { EditorialSection } from '../../components/ui/editorial-section';
import { SpecGrid } from '../../components/ui/spec-grid';
import { StatusDot } from '../../components/ui/status-dot';
import type { StatusTone } from '../../components/ui/status-dot';
import { Timeline } from '../../components/ui/timeline';
import type { TimelineItem } from '../../components/ui/timeline';
import { ErrorState } from '../../components/states';
import { formatRelative, formatTimeFull } from '../../lib/format';
import { useErrorText } from '../../i18n/error-text';
import { instanceStatus, LIMIT_FIELDS, shortVersion } from './instance-display';
import type { InstanceStatus } from './instance-display';
import { InstanceTestPanel } from './instance-test-panel';
import type { Instance, TestResult } from './instance-contract';

const STATUS_TONES: Record<InstanceStatus, StatusTone> = {
  ready: 'success',
  auth_blocked: 'danger',
  error: 'warning',
  untested: 'muted',
};

/** 渲染事实条：状态、登录方式、版本与最近测试，以大字号扫读。
 * @param props instance 实例。
 * @returns 发丝线分隔的四格事实。
 * @throws 不适用。
 */
function FactStrip({ instance }: { instance: Instance }) {
  const { t } = useTranslation('instances');
  const status = instanceStatus(instance);
  const statusLabel =
    status === 'error' ? t('status.error') : t(`authState.${status}`);
  const facts = [
    {
      label: t('detail.status'),
      value: (
        <span className="inline-flex items-center gap-3">
          <StatusDot tone={STATUS_TONES[status]} pulse={status === 'ready'} />
          {statusLabel}
        </span>
      ),
    },
    {
      label: t('detail.authMode'),
      value:
        instance.auth.mode === 'token'
          ? t('form.modeToken')
          : `${t('form.modePassword')} · ${instance.auth.username ?? ''}`,
    },
    {
      label: t('detail.version'),
      value: (
        <span className="font-mono" title={instance.openlistVersion ?? undefined}>
          {shortVersion(instance.openlistVersion) ?? t('detail.unknownVersion')}
        </span>
      ),
    },
    {
      label: t('detail.lastTested'),
      value: (
        <span title={formatTimeFull(instance.lastTestAt)}>
          {instance.lastTestAt ? formatRelative(instance.lastTestAt) : t('detail.neverTested')}
        </span>
      ),
    },
  ];
  return (
    <dl className="grid grid-cols-2 border-y border-hairline lg:grid-cols-4">
      {facts.map((fact, position) => (
        <div
          key={fact.label}
          className={`min-w-0 py-6 ${position % 2 === 1 ? 'border-l border-hairline pl-6' : ''} ${position >= 2 ? 'border-t border-hairline lg:border-t-0' : ''} ${position === 2 ? 'lg:border-l lg:pl-6' : ''}`}
        >
          <dt className="eyebrow">{fact.label}</dt>
          <dd className="mt-3 truncate font-display text-2xl font-medium tracking-tight">
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 渲染最近错误：本地化说明加原始诊断行。
 * @param props error 实例记录的最近错误。
 * @returns 警示块。
 * @throws 不适用。
 */
function LastError({ error }: { error: NonNullable<Instance['lastError']> }) {
  const { t } = useTranslation('instances');
  const errorText = useErrorText();
  return (
    <div className="mt-8 flex gap-4 rounded-2xl border border-signal/25 bg-signal/[0.05] p-5">
      <CircleAlert size={18} className="mt-0.5 shrink-0 text-signal" aria-hidden="true" />
      <div className="min-w-0">
        <p className="eyebrow text-signal">{t('detail.lastError')}</p>
        <p className="mt-2 text-sm">{errorText(error.code, error.message)}</p>
        <p className="mt-1.5 font-mono text-[11px] break-all text-muted-foreground">
          {error.code} · {error.message}
        </p>
      </div>
    </div>
  );
}

/** 渲染只读详情。
 * @param props instance 实例；test 页面持有的连接测试 mutation。
 * @returns 详情内容。
 * @throws 不适用。
 */
export function InstanceDetailView({
  instance,
  test,
}: {
  instance: Instance;
  test: UseMutationResult<TestResult, Error, boolean>;
}) {
  const { t } = useTranslation('instances');

  const role =
    instance.accountRole === null
      ? null
      : instance.accountRole === 2
        ? t('role.admin', { role: instance.accountRole })
        : t('role.user', { role: instance.accountRole });
  const multipart =
    instance.multipartEnabled === true
      ? t('detail.enabled')
      : instance.multipartEnabled === false
        ? t('detail.disabled')
        : t('detail.unknown');

  // 时间线按发生顺序：创建 → 最近测试 → 最近更新；阻止截止时间作为警示节点放在最后。
  const timeline: TimelineItem[] = [
    { label: t('detail.created'), time: formatTimeFull(instance.createdAt) },
    {
      label: t('detail.lastTested'),
      time: instance.lastTestAt ? formatTimeFull(instance.lastTestAt) : null,
      note: instance.lastTestAt ? formatRelative(instance.lastTestAt) : undefined,
    },
    { label: t('detail.updated'), time: formatTimeFull(instance.updatedAt) },
    ...(instance.authBlockedUntil
      ? [
          {
            label: t('detail.blockedUntil'),
            time: formatTimeFull(instance.authBlockedUntil),
            tone: 'danger' as const,
          },
        ]
      : []),
  ];

  return (
    <div>
      <FactStrip instance={instance} />

      <AnimatePresence initial={false}>
        {(test.isPending || test.data) && (
          <InstanceTestPanel key="test" pending={test.isPending} result={test.data} />
        )}
      </AnimatePresence>
      {test.isError && (
        <div className="mt-8">
          <ErrorState error={test.error} />
        </div>
      )}
      {instance.lastError && !test.data && <LastError error={instance.lastError} />}

      <div className="mt-12">
        <EditorialSection index="01" title={t('detail.account')} description={t('detail.accountHint')}>
          {instance.accountUsername ? (
            <SpecGrid
              columns={2}
              items={[
                { label: t('detail.username'), value: instance.accountUsername },
                { label: t('detail.basePath'), value: instance.accountBasePath ?? '—', mono: true },
                { label: t('detail.role'), value: role ?? '—' },
                { label: t('detail.permissions'), value: instance.accountPermissions ?? '—', mono: true },
              ]}
            />
          ) : (
            <p className="text-sm leading-7 text-muted-foreground">{t('detail.accountEmpty')}</p>
          )}
        </EditorialSection>

        <EditorialSection index="02" title={t('detail.limits')} description={t('detail.limitsHint')}>
          <SpecGrid
            columns={4}
            items={[
              ...LIMIT_FIELDS.map((field) => ({
                label: t(`limits.${field.key}`),
                value: (
                  <span className="font-display text-3xl font-medium tracking-tight">
                    {instance.limits[field.key] === 0 ? (
                      t('detail.unlimited')
                    ) : (
                      <CountUp value={instance.limits[field.key]} />
                    )}
                  </span>
                ),
              })),
              {
                label: t('detail.downloadMode'),
                value:
                  instance.downloadMode === 'd' ? t('form.downloadDirect') : t('form.downloadProxy'),
              },
              { label: t('detail.multipart'), value: multipart },
            ]}
          />
        </EditorialSection>

        <EditorialSection index="03" title={t('detail.timeline')} description={t('detail.timelineHint')}>
          <Timeline items={timeline} />
        </EditorialSection>
      </div>
    </div>
  );
}
