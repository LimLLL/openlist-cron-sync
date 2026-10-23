// 目标列表：逐个配置实例、路径、同步模式、创建方式、并发、密码、刷新与删除阈值；保留稳定 ID。
import { Plus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { EditorialSection } from '../../components/ui/editorial-section';
import { InputField } from '../../components/ui/input-field';
import { SelectField } from '../../components/ui/select-field';
import { Segmented } from '../../components/ui/segmented';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { emptyTarget, targetCreateModeState } from './job-form-model';
import { BrowseButton, SwitchRow } from './job-ui';
import type { Instance } from '../instances/instance-contract';
import type { TargetInput } from './job-form-model';

const MAX_TARGETS = 32;
const EASE = [0.16, 1, 0.3, 1] as const;

/** 单个目标子块属性。 */
interface TargetBlockProps {
  /** 当前源实例。 */
  sourceInstanceId: string;
  /** 当前目标。 */
  target: TargetInput;
  /** 目标序号（从 0 起）。 */
  index: number;
  /** 可选实例。 */
  instances: Instance[];
  /** 是否允许移除。 */
  canRemove: boolean;
  /** 更新字段。 */
  onChange: <K extends keyof TargetInput>(
    field: K,
    value: TargetInput[K],
  ) => void;
  /** 打开此目标的目录选择器。 */
  onBrowse: () => void;
  /** 移除此目标。 */
  onRemove: () => void;
}

/** 渲染一个目标的全部字段。
 * @param props 源实例、目标、实例与回调。
 * @returns 目标子块。
 * @throws 不适用。
 */
function TargetBlock({
  sourceInstanceId,
  target,
  index,
  instances,
  canRemove,
  onChange,
  onBrowse,
  onRemove,
}: TargetBlockProps) {
  const { t } = useTranslation('jobs');
  const label = t('form.target', { index: index + 1 });
  const createMode = targetCreateModeState(sourceInstanceId, target);
  const modeHintId = `target-${index}-create-mode-hint`;
  const serverCopy = target.createMode === 'server_copy';
  // 服务端复制不限时会一次提交全部待复制任务，在提示位置给出风险说明。
  const unlimitedCopy =
    serverCopy &&
    target.concurrentFiles.trim() !== '' &&
    Number(target.concurrentFiles) === 0;
  return (
    <fieldset className="rounded-[1.4rem] border border-hairline bg-white/[0.015] p-5 sm:p-6">
      <legend className="sr-only">{label}</legend>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[11px] text-accent">{`T${String(index + 1).padStart(2, '0')}`}</span>
          <span className="text-sm font-medium" aria-hidden="true">
            {label}
          </span>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
            aria-label={t('form.removeTarget', { index: index + 1 })}
          >
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          id={`target-${index}-instance`}
          label={t('form.instance')}
          value={target.instanceId}
          onChange={(event) => onChange('instanceId', event.target.value)}
          required
        >
          <option value="" disabled>
            {t('form.selectInstance')}
          </option>
          {instances.map((instance) => (
            <option key={instance.id} value={instance.id}>
              {instance.name}
            </option>
          ))}
        </SelectField>
        <InputField
          id={`target-${index}-path`}
          label={t('form.path')}
          value={target.path}
          onChange={(event) => onChange('path', event.target.value)}
          required
          placeholder="/"
          action={
            <BrowseButton disabled={!target.instanceId} onClick={onBrowse} />
          }
        />
        <div className="space-y-2">
          <p className="field-label">{t('form.mode')}</p>
          <Segmented
            label={t('form.mode')}
            value={target.mode}
            onChange={(mode) => onChange('mode', mode)}
            options={[
              { value: 'incremental', label: t('mode.incremental') },
              { value: 'mirror', label: t('mode.mirror') },
            ]}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            {t('form.modeHint')}
          </p>
        </div>
        <div className="space-y-2">
          <p className="field-label">{t('form.createMode')}</p>
          <Segmented
            label={`${label}: ${t('form.createMode')}`}
            value={target.createMode}
            onChange={(mode) => onChange('createMode', mode)}
            describedBy={modeHintId}
            invalid={createMode.invalid}
            options={[
              { value: 'relay', label: t('createMode.relay') },
              {
                value: 'server_copy',
                label: t('createMode.server_copy'),
                disabled: createMode.unavailable,
              },
            ]}
          />
          <p
            id={modeHintId}
            role={createMode.invalid ? 'alert' : undefined}
            className={cn(
              'text-xs leading-5',
              createMode.invalid ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {createMode.invalid
              ? t('validation.serverCopySameInstance')
              : t('form.createModeHint')}
          </p>
        </div>
        <InputField
          id={`target-${index}-concurrent-files`}
          label={t('form.concurrentFiles')}
          type="number"
          inputMode="numeric"
          min={0}
          required
          value={target.concurrentFiles}
          onChange={(event) => onChange('concurrentFiles', event.target.value)}
          hint={
            unlimitedCopy
              ? t('form.concurrentFilesCopyUnlimited')
              : serverCopy
                ? t('form.concurrentFilesCopyHint')
                : t('form.concurrentFilesRelayHint')
          }
          hintTone={unlimitedCopy ? 'warning' : undefined}
        />
        <InputField
          id={`target-${index}-chunk-concurrency`}
          label={t('form.chunkConcurrency')}
          type="number"
          inputMode="numeric"
          min={1}
          max={8}
          required
          disabled={serverCopy}
          value={target.chunkConcurrency}
          onChange={(event) => onChange('chunkConcurrency', event.target.value)}
          hint={
            serverCopy
              ? t('form.chunkConcurrencyCopyHint')
              : t('form.chunkConcurrencyHint')
          }
        />
        <InputField
          id={`target-${index}-password`}
          label={t('form.pathPassword')}
          type="password"
          autoComplete="off"
          value={target.password}
          onChange={(event) => onChange('password', event.target.value)}
          hint={target.existingId ? t('form.keepPassword') : t('form.optional')}
        />
        <SwitchRow
          label={t('form.refreshTarget')}
          checked={target.refresh}
          onChange={(checked) => onChange('refresh', checked)}
        />
        <SwitchRow
          label={t('form.deleteLimits')}
          hint={t('form.deleteLimitsHint')}
          checked={target.deleteLimitsEnabled}
          onChange={(checked) => onChange('deleteLimitsEnabled', checked)}
        />
        {target.deleteLimitsEnabled && (
          <>
            <InputField
              id={`target-${index}-max-count`}
              label={t('form.maxCount')}
              type="number"
              min={0}
              value={target.maxCount}
              onChange={(event) => onChange('maxCount', event.target.value)}
              hint={t('form.maxCountHint')}
            />
            <InputField
              id={`target-${index}-max-percent`}
              label={t('form.maxPercent')}
              type="number"
              min={0}
              max={100}
              value={target.maxPercent}
              onChange={(event) => onChange('maxPercent', event.target.value)}
              hint={t('form.maxPercentHint')}
            />
          </>
        )}
      </div>
    </fieldset>
  );
}

/** 渲染目标分节：编号子块列表与“添加目标”。
 * @param props sourceInstanceId 当前源实例；targets 当前目标集合；instances 可选实例；onChange 整体替换目标集合；onBrowse 按位置打开目录选择器。
 * @returns 分节。
 * @throws 不适用。
 */
export function TargetsFields({
  sourceInstanceId,
  targets,
  instances,
  onChange,
  onBrowse,
}: {
  sourceInstanceId: string;
  targets: TargetInput[];
  instances: Instance[];
  onChange: (targets: TargetInput[]) => void;
  onBrowse: (index: number) => void;
}) {
  const { t } = useTranslation('jobs');
  return (
    <EditorialSection
      index="03"
      title={t('form.targets')}
      description={t('form.targetsDesc')}
    >
      <div className="space-y-4">
        <AnimatePresence initial={false}>
          {targets.map((target, index) => (
            <motion.div
              // 已有目标用稳定 ID；新目标用位置，删除后其后的新目标会重新挂载。
              key={target.existingId ?? `new-${index}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.45, ease: EASE }}
            >
              <TargetBlock
                sourceInstanceId={sourceInstanceId}
                target={target}
                index={index}
                instances={instances}
                canRemove={targets.length > 1}
                onBrowse={() => onBrowse(index)}
                onChange={(field, value) =>
                  onChange(
                    targets.map((item, position) =>
                      position === index ? { ...item, [field]: value } : item,
                    ),
                  )
                }
                onRemove={() =>
                  onChange(targets.filter((_, position) => position !== index))
                }
              />
            </motion.div>
          ))}
        </AnimatePresence>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange([...targets, emptyTarget()])}
          disabled={targets.length >= MAX_TARGETS}
        >
          <Plus size={14} aria-hidden="true" />
          {t('form.addTarget')}
        </Button>
      </div>
    </EditorialSection>
  );
}
