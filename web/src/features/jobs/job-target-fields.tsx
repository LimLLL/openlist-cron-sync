// 任务表单的目标分区：逐个配置实例、路径、同步模式、创建方式、并发、密码、刷新与删除上限；已有目标保留稳定 ID。
import { FolderOpen, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Section } from '../../components/page';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input, NativeSelect } from '../../components/ui/input';
import { Segmented } from '../../components/ui/segmented';
import { SwitchField } from '../../components/ui/switch';
import { cn } from '../../lib/utils';
import { emptyTarget, targetCreateModeState } from './job-form-model';
import type { Instance } from '../instances/instance-contract';
import type { TargetInput } from './job-form-model';

const MAX_TARGETS = 32;

/** 实例下拉框属性。 */
interface InstanceSelectProps {
  /** 选择框 id。 */
  id: string;
  /** 当前实例 ID。 */
  value: string;
  /** 可选实例。 */
  instances: Pick<Instance, 'id' | 'name'>[];
  /** 选择回调。 */
  onChange: (value: string) => void;
}

/** 渲染实例下拉框（含“选择实例”占位）。
 * @param props id、当前值、实例与回调。
 * @returns 原生下拉框。
 * @throws 不适用。
 */
export function InstanceSelect({
  id,
  value,
  instances,
  onChange,
  ...rest
}: InstanceSelectProps) {
  const { t } = useTranslation('jobs');
  return (
    <NativeSelect
      {...rest}
      id={id}
      value={value}
      required
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" disabled>
        {t('form.selectInstance')}
      </option>
      {instances.map((instance) => (
        <option key={instance.id} value={instance.id}>
          {instance.name}
        </option>
      ))}
    </NativeSelect>
  );
}

/** 路径输入与浏览按钮属性。 */
interface PathFieldProps {
  /** 输入框 id。 */
  id: string;
  /** 字段标签。 */
  label: string;
  /** 当前路径。 */
  value: string;
  /** 修改回调。 */
  onChange: (value: string) => void;
  /** 打开目录选择器；未选择实例时禁用。 */
  onBrowse: () => void;
  /** 是否可浏览。 */
  canBrowse: boolean;
}

/** 渲染路径输入框及右侧“浏览”按钮。
 * @param props 路径值与回调。
 * @returns 路径字段。
 * @throws 不适用。
 */
export function PathField({
  id,
  label,
  value,
  onChange,
  onBrowse,
  canBrowse,
}: PathFieldProps) {
  const { t } = useTranslation('jobs');
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          required
          placeholder="/"
          translate="no"
          className="font-mono"
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          onClick={onBrowse}
          disabled={!canBrowse}
          aria-label={t('form.browseFor', { label })}
        >
          <FolderOpen size={14} aria-hidden="true" />
          {t('form.browse')}
        </Button>
      </div>
    </div>
  );
}

/** 单个目标子块属性。 */
interface TargetBlockProps {
  /** 当前源实例。 */
  sourceInstanceId: string;
  /** 当前目标。 */
  target: TargetInput;
  /** 目标序号（从 0 起）。 */
  index: number;
  /** 可选实例。 */
  instances: Pick<Instance, 'id' | 'name'>[];
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
  const { t } = useTranslation(['jobs', 'common']);
  const label = t('form.target', { index: index + 1 });
  const createMode = targetCreateModeState(sourceInstanceId, target);
  const serverCopy = target.createMode === 'server_copy';
  // 数值等于 0（含 00、0.0 等写法）表示不限；空值视为未填写而不是不限。
  const unlimited =
    target.concurrentFiles.trim() !== '' &&
    Number(target.concurrentFiles) === 0;
  const prefix = `target-${index}`;
  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="sr-only">{label}</legend>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span aria-hidden="true" className="text-[13px] font-semibold">
          {label}
        </span>
        {canRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            aria-label={t('form.removeTarget', { index: index + 1 })}
            className="hover:text-danger"
          >
            <X size={14} aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field id={`${prefix}-instance`} label={t('form.instance')}>
          <InstanceSelect
            id={`${prefix}-instance`}
            value={target.instanceId}
            instances={instances}
            onChange={(value) => onChange('instanceId', value)}
          />
        </Field>
        <PathField
          id={`${prefix}-path`}
          label={t('form.path')}
          value={target.path}
          onChange={(value) => onChange('path', value)}
          onBrowse={onBrowse}
          canBrowse={target.instanceId !== ''}
        />
        <div className="min-w-0 space-y-1.5">
          <p className="text-[13px] font-medium">{t('form.mode')}</p>
          <Segmented
            label={`${label}: ${t('form.mode')}`}
            value={target.mode}
            onChange={(mode) => onChange('mode', mode)}
            options={[
              {
                value: 'incremental',
                label: t('common:targetMode.incremental'),
              },
              { value: 'mirror', label: t('common:targetMode.mirror') },
            ]}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('form.modeHint')}
          </p>
        </div>
        <div className="min-w-0 space-y-1.5">
          <p className="text-[13px] font-medium">{t('form.createMode')}</p>
          <Segmented
            label={`${label}: ${t('form.createMode')}`}
            value={target.createMode}
            onChange={(mode) => onChange('createMode', mode)}
            options={[
              { value: 'relay', label: t('common:operationMethod.relay') },
              {
                value: 'server_copy',
                label: t('common:operationMethod.server_copy'),
                disabled: createMode.unavailable,
              },
            ]}
          />
          <p
            role={createMode.invalid ? 'alert' : undefined}
            className={cn(
              'text-xs leading-relaxed',
              createMode.invalid ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {createMode.invalid
              ? t('validation.serverCopySameInstance')
              : t('form.createModeHint')}
          </p>
        </div>
        <Field
          id={`${prefix}-concurrent-files`}
          label={t('form.concurrentFiles')}
          hint={
            unlimited ? (
              <span className="text-warning">
                {serverCopy
                  ? t('form.concurrentFilesCopyUnlimited')
                  : t('form.concurrentFilesRelayUnlimited')}
              </span>
            ) : serverCopy ? (
              t('form.concurrentFilesCopyHint')
            ) : (
              t('form.concurrentFilesRelayHint')
            )
          }
        >
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            required
            value={target.concurrentFiles}
            onChange={(event) =>
              onChange('concurrentFiles', event.target.value)
            }
          />
        </Field>
        <Field
          id={`${prefix}-chunk-concurrency`}
          label={t('form.chunkConcurrency')}
          hint={
            serverCopy
              ? t('form.chunkConcurrencyCopyHint')
              : t('form.chunkConcurrencyHint')
          }
        >
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={8}
            required
            disabled={serverCopy}
            value={target.chunkConcurrency}
            onChange={(event) =>
              onChange('chunkConcurrency', event.target.value)
            }
          />
        </Field>
        <Field
          id={`${prefix}-scan-interval`}
          label={t('form.scanInterval')}
          hint={t('form.scanIntervalHint')}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={3600}
            required
            value={target.scanIntervalSeconds}
            onChange={(event) =>
              onChange('scanIntervalSeconds', event.target.value)
            }
          />
        </Field>
        <Field
          id={`${prefix}-password`}
          label={t('form.pathPassword')}
          hint={target.existingId ? t('form.keepPassword') : t('form.optional')}
        >
          <Input
            type="password"
            autoComplete="off"
            value={target.password}
            onChange={(event) => onChange('password', event.target.value)}
          />
        </Field>
        <SwitchField
          id={`${prefix}-refresh`}
          label={t('form.refreshTarget')}
          checked={target.refresh}
          onCheckedChange={(checked) => onChange('refresh', checked)}
        />
        <SwitchField
          id={`${prefix}-delete-limits`}
          label={t('form.deleteLimits')}
          hint={t('form.deleteLimitsHint')}
          checked={target.deleteLimitsEnabled}
          onCheckedChange={(checked) =>
            onChange('deleteLimitsEnabled', checked)
          }
        />
        {target.deleteLimitsEnabled && (
          <>
            <Field
              id={`${prefix}-max-count`}
              label={t('form.maxCount')}
              hint={t('form.maxCountHint')}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={target.maxCount}
                onChange={(event) => onChange('maxCount', event.target.value)}
              />
            </Field>
            <Field
              id={`${prefix}-max-percent`}
              label={t('form.maxPercent')}
              hint={t('form.maxPercentHint')}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                value={target.maxPercent}
                onChange={(event) => onChange('maxPercent', event.target.value)}
              />
            </Field>
          </>
        )}
      </div>
    </fieldset>
  );
}

/** 目标分区属性。 */
interface TargetsFieldsProps {
  /** 当前源实例。 */
  sourceInstanceId: string;
  /** 当前目标集合。 */
  targets: TargetInput[];
  /** 可选实例。 */
  instances: Pick<Instance, 'id' | 'name'>[];
  /** 整体替换目标集合。 */
  onChange: (targets: TargetInput[]) => void;
  /** 按位置打开目录选择器。 */
  onBrowse: (index: number) => void;
}

/** 渲染目标分区：目标子块列表与“添加目标”。
 * @param props 源实例、目标集合、实例与回调。
 * @returns 目标分区。
 * @throws 不适用。
 */
export function TargetsFields({
  sourceInstanceId,
  targets,
  instances,
  onChange,
  onBrowse,
}: TargetsFieldsProps) {
  const { t } = useTranslation('jobs');
  return (
    <Section
      title={t('form.targets')}
      description={t('form.targetsDesc')}
      actions={
        <Button
          size="sm"
          onClick={() => onChange([...targets, emptyTarget()])}
          disabled={targets.length >= MAX_TARGETS}
        >
          <Plus size={13} aria-hidden="true" />
          {t('form.addTarget')}
        </Button>
      }
    >
      <div className="space-y-3">
        {targets.map((target, index) => (
          <TargetBlock
            // 已有目标用稳定 ID；新目标用位置，删除后其后的新目标会重新挂载。
            key={target.existingId ?? `new-${index}`}
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
        ))}
      </div>
    </Section>
  );
}
