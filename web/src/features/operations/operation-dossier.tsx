// 操作详情的路径档案：源 → 方式 → 目标的三栏视图（连线上的光点表示流向），以及四格传输统计。
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CountUp } from '../../components/motion/count-up';
import { SpecGrid } from '../../components/ui/spec-grid';
import { formatBytes } from '../../lib/format';
import { cn } from '../../lib/utils';
import type { OperationView } from './operation-contract';
import { ACTION_ICONS, splitPath } from './operation-status';

/** 渲染单个端点：角色、实例名称（悬停显示完整 ID）、父目录与醒目的末段名称。
 * @param props role 源或目标；path 路径；instance 实例 ID 与名称；size 预期大小；isDir 是否目录。
 * @returns 端点栏。
 * @throws 不适用。
 */
function Endpoint({
  role,
  path,
  instance,
  size,
  isDir,
}: {
  role: 'source' | 'target';
  path: string;
  instance: { id: string; name: string } | null;
  size: number | null;
  isDir: boolean;
}) {
  const { t } = useTranslation('operations');
  const { parent, name } = splitPath(path);
  return (
    <div className="min-w-0 p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">{t(`detail.${role}`)}</p>
        {instance && (
          <span
            className="max-w-[60%] truncate text-xs text-muted-foreground"
            title={instance.id}
          >
            {instance.name}
          </span>
        )}
      </div>
      <p className="mt-6 font-mono text-[12.5px] leading-6 break-all text-muted-foreground">
        {parent}
      </p>
      <p
        className={cn(
          'font-display text-2xl leading-tight font-medium tracking-tight break-all sm:text-[1.75rem]',
          role === 'target' && 'text-accent',
        )}
      >
        {name || path}
      </p>
      <p className="mt-4 font-mono text-[11.5px] text-muted-foreground">
        {isDir
          ? t('detail.directory')
          : size !== null
            ? t('detail.expected', { size: formatBytes(size) })
            : '—'}
      </p>
    </div>
  );
}

/** 渲染源与目标之间的连线：方式胶囊居中，光点沿流向循环移动（减弱动效时静止）。
 * @param props label 方式名称。
 * @returns 连线栏。
 * @throws 不适用。
 */
function Connector({ label }: { label: string }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <div className="relative flex items-center justify-center px-6 py-4 lg:w-52 lg:px-0 lg:py-0">
      {/* 横向发丝线（桌面）/ 纵向发丝线（移动端） */}
      <span
        aria-hidden="true"
        className="absolute inset-x-6 top-1/2 h-px bg-hairline lg:inset-x-0"
      />
      {!reduced && (
        <motion.span
          aria-hidden="true"
          className="absolute top-1/2 left-6 size-1.5 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_12px_var(--color-accent)] lg:left-0"
          animate={{ left: ['0%', '100%'], opacity: [0, 1, 1, 0] }}
          transition={{
            duration: 2.6,
            ease: 'easeInOut',
            repeat: Infinity,
            repeatDelay: 0.4,
          }}
        />
      )}
      <span className="relative inline-flex items-center gap-2 rounded-full border border-hairline bg-background/80 px-3.5 py-1.5 text-xs text-foreground backdrop-blur">
        {label}
        <ArrowRight
          size={13}
          className="rotate-90 text-accent lg:rotate-0"
          aria-hidden="true"
        />
      </span>
    </div>
  );
}

/** 渲染路径档案；没有源端的步骤（创建目录、删除）只显示目标与动作。
 * @param props op 操作视图。
 * @returns 档案面板。
 * @throws 不适用。
 */
export function PathDossier({ op }: { op: OperationView }) {
  const { t } = useTranslation(['operations', 'common']);
  const Icon = ACTION_ICONS[op.action];
  const target = (
    <Endpoint
      role="target"
      path={op.targetPath}
      instance={{ id: op.targetInstanceId, name: op.targetInstanceName }}
      size={op.expectedTargetSize ?? op.expectedSourceSize}
      isDir={op.isDir}
    />
  );
  if (op.sourcePath === null)
    return (
      <div className="panel mb-10 overflow-hidden">
        <div className="flex items-center gap-3 border-b border-hairline px-6 py-4 text-sm sm:px-8">
          <Icon size={16} className="text-accent" aria-hidden="true" />
          {t(`common:operationAction.${op.action}`)}
          <span className="text-muted-foreground">
            · {t('detail.noSource')}
          </span>
        </div>
        {target}
      </div>
    );
  return (
    <div className="panel mb-10 grid overflow-hidden lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <Endpoint
        role="source"
        path={op.sourcePath}
        instance={
          op.sourceInstanceId && op.sourceInstanceName
            ? { id: op.sourceInstanceId, name: op.sourceInstanceName }
            : null
        }
        size={op.expectedSourceSize}
        isDir={op.isDir}
      />
      <Connector label={t(`common:operationMethod.${op.method}`)} />
      {target}
    </div>
  );
}

/** 把格式化后的字节拆成数字与单位，数字用大号字形展示。
 * @param bytes 字节数。
 * @returns 数字与单位元素。
 * @throws 不适用。
 */
function ByteFigure({ bytes }: { bytes: number }) {
  const [value, unit] = formatBytes(bytes).split(' ');
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="stat-figure">{value}</span>
      <span className="font-mono text-sm text-muted-foreground">{unit}</span>
    </span>
  );
}

/** 按动作渲染统计：复制显示传输四格，删除显示影响三格，创建目录没有可统计的传输而不显示。
 * @param props op 操作视图。
 * @returns 统计网格或 null。
 * @throws 不适用。
 */
export function OperationStats({ op }: { op: OperationView }) {
  const { t } = useTranslation('operations');
  if (op.action === 'mkdir') return null;
  const files = {
    label: t('detail.stats.affectedFiles'),
    value: <CountUp value={op.affectedFileCount} className="stat-figure" />,
  };
  const attempt = {
    label: t('detail.stats.attempt'),
    value: <CountUp value={op.attemptNo} className="stat-figure" />,
  };
  if (op.action === 'delete')
    return (
      <SpecGrid
        columns={3}
        className="mb-4"
        items={[
          files,
          {
            label: t('detail.record.affectedBytes'),
            value: <ByteFigure bytes={op.affectedBytes} />,
          },
          attempt,
        ]}
      />
    );
  return (
    <SpecGrid
      columns={4}
      className="mb-4"
      items={[
        {
          label: t('detail.stats.transferred'),
          value: <ByteFigure bytes={op.bytesTransferred} />,
        },
        {
          label: t('detail.stats.downloaded'),
          value: <ByteFigure bytes={op.bytesDownloaded} />,
        },
        files,
        attempt,
      ]}
    />
  );
}
