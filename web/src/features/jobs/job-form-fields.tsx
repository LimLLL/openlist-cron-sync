// 任务表单的分区字段：基本信息、源、定时、过滤规则与可折叠的高级设置；目标分区见 job-target-fields。
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Section } from '../../components/page';
import { Field } from '../../components/ui/field';
import { Input, Textarea } from '../../components/ui/input';
import { SwitchField } from '../../components/ui/switch';
import { InstanceSelect, PathField } from './job-target-fields';
import type { Instance } from '../instances/instance-contract';
import type { JobFormValues } from './job-form-model';

/** 更新单个表单字段。 */
export type UpdateField = <K extends keyof JobFormValues>(
  field: K,
  value: JobFormValues[K],
) => void;

/** 分区共用属性。 */
interface FieldsProps {
  /** 当前表单值。 */
  values: JobFormValues;
  /** 字段更新函数。 */
  update: UpdateField;
}

/** 渲染数字输入字段。
 * @param props id、标签、说明、取值范围与受控值。
 * @returns 字段。
 * @throws 不适用。
 */
function NumberField({
  id,
  label,
  hint,
  min,
  max,
  required = true,
  value,
  onChange,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  min?: number;
  max?: number;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** 渲染基本信息分区（任务名称）。
 * @param props 表单值与更新函数。
 * @returns 分区。
 * @throws 不适用。
 */
export function BasicsFields({ values, update }: FieldsProps) {
  const { t } = useTranslation('jobs');
  return (
    <Section title={t('form.basics')}>
      <Field id="job-name" label={t('form.name')}>
        <Input
          required
          maxLength={100}
          value={values.name}
          placeholder={t('form.namePlaceholder')}
          onChange={(event) => update('name', event.target.value)}
        />
      </Field>
    </Section>
  );
}

/** 渲染源分区。
 * @param props 表单值、更新函数、可选实例、是否编辑与浏览回调。
 * @returns 分区。
 * @throws 不适用。
 */
export function SourceFields({
  values,
  update,
  instances,
  isEdit,
  onBrowse,
}: FieldsProps & {
  instances: Pick<Instance, 'id' | 'name'>[];
  isEdit: boolean;
  onBrowse: () => void;
}) {
  const { t } = useTranslation('jobs');
  return (
    <Section title={t('form.source')} description={t('form.sourceDesc')}>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field id="source-instance" label={t('form.instance')}>
          <InstanceSelect
            id="source-instance"
            value={values.sourceInstanceId}
            instances={instances}
            onChange={(value) => update('sourceInstanceId', value)}
          />
        </Field>
        <PathField
          id="source-path"
          label={t('form.path')}
          value={values.sourcePath}
          onChange={(value) => update('sourcePath', value)}
          onBrowse={onBrowse}
          canBrowse={values.sourceInstanceId !== ''}
        />
        <Field
          id="source-password"
          label={t('form.pathPassword')}
          hint={isEdit ? t('form.keepPassword') : t('form.optional')}
        >
          <Input
            type="password"
            autoComplete="off"
            value={values.sourcePassword}
            onChange={(event) => update('sourcePassword', event.target.value)}
          />
        </Field>
        <SwitchField
          id="source-refresh"
          label={t('form.refreshSource')}
          hint={t('form.refreshHint')}
          checked={values.sourceRefresh}
          onCheckedChange={(checked) => update('sourceRefresh', checked)}
          className="sm:pt-6"
        />
        <NumberField
          id="source-download-concurrency"
          label={t('form.sourceDownloadConcurrency')}
          hint={t('form.sourceDownloadConcurrencyHint')}
          min={0}
          value={values.sourceDownloadConcurrency}
          onChange={(value) => update('sourceDownloadConcurrency', value)}
        />
        <NumberField
          id="source-scan-interval"
          label={t('form.sourceScanInterval')}
          hint={t('form.sourceScanIntervalHint')}
          min={0}
          max={3600}
          value={values.sourceScanIntervalSeconds}
          onChange={(value) => update('sourceScanIntervalSeconds', value)}
        />
      </div>
    </Section>
  );
}

/** 渲染定时分区。
 * @param props 表单值与更新函数。
 * @returns 分区。
 * @throws 不适用。
 */
export function ScheduleFields({ values, update }: FieldsProps) {
  const { t } = useTranslation('jobs');
  return (
    <Section title={t('form.schedule')}>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field id="job-cron" label={t('form.cron')} hint={t('form.cronHint')}>
          <Input
            value={values.cron}
            placeholder="0 3 * * *"
            translate="no"
            className="font-mono"
            onChange={(event) => update('cron', event.target.value)}
          />
        </Field>
        <Field
          id="job-timezone"
          label={t('form.timezone')}
          hint={t('form.timezoneHint')}
        >
          <Input
            required
            value={values.timezone}
            translate="no"
            onChange={(event) => update('timezone', event.target.value)}
          />
        </Field>
      </div>
    </Section>
  );
}

/** 渲染过滤规则分区。
 * @param props 表单值与更新函数。
 * @returns 分区。
 * @throws 不适用。
 */
export function FilterFields({ values, update }: FieldsProps) {
  const { t } = useTranslation('jobs');
  return (
    <Section title={t('form.filters')} description={t('form.filtersDesc')}>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field
          id="job-include"
          label={t('form.include')}
          hint={t('form.includeHint')}
        >
          <Textarea
            rows={3}
            translate="no"
            value={values.includePatterns}
            onChange={(event) => update('includePatterns', event.target.value)}
          />
        </Field>
        <Field
          id="job-exclude"
          label={t('form.exclude')}
          hint={t('form.excludeHint')}
        >
          <Textarea
            rows={3}
            translate="no"
            value={values.excludePatterns}
            onChange={(event) => update('excludePatterns', event.target.value)}
          />
        </Field>
        <NumberField
          id="job-min-size"
          label={t('form.minSize')}
          hint={t('form.noLimit')}
          min={0}
          required={false}
          value={values.minSizeBytes}
          onChange={(value) => update('minSizeBytes', value)}
        />
        <NumberField
          id="job-max-size"
          label={t('form.maxSize')}
          hint={t('form.noLimit')}
          min={0}
          required={false}
          value={values.maxSizeBytes}
          onChange={(value) => update('maxSizeBytes', value)}
        />
      </div>
    </Section>
  );
}

/** 渲染默认折叠的高级设置（原生 details，键盘与读屏行为由浏览器提供）。
 * @param props 表单值与更新函数。
 * @returns 可折叠分区。
 * @throws 不适用。
 */
export function AdvancedFields({ values, update }: FieldsProps) {
  const { t } = useTranslation('jobs');
  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={14}
          aria-hidden="true"
          className="text-muted-foreground transition-transform group-open:rotate-90"
        />
        <span className="text-[13px] font-semibold">{t('form.advanced')}</span>
        <span className="truncate text-xs text-muted-foreground">
          {t('form.advancedDesc')}
        </span>
      </summary>
      <div className="grid gap-x-4 gap-y-3 border-t border-border p-4 sm:grid-cols-2">
        <SwitchField
          id="job-allow-empty-source"
          label={t('form.allowEmptySource')}
          hint={t('form.allowEmptySourceHint')}
          checked={values.allowEmptySource}
          onCheckedChange={(checked) => update('allowEmptySource', checked)}
        />
        <SwitchField
          id="job-sync-empty-dirs"
          label={t('form.syncEmptyDirs')}
          hint={t('form.syncEmptyDirsHint')}
          checked={values.syncEmptyDirs}
          onCheckedChange={(checked) => update('syncEmptyDirs', checked)}
        />
        <NumberField
          id="job-bandwidth"
          label={t('form.bandwidth')}
          hint={t('form.bandwidthHint')}
          min={0}
          value={values.relayBandwidthLimit}
          onChange={(value) => update('relayBandwidthLimit', value)}
        />
        <NumberField
          id="job-retry-count"
          label={t('form.retryCount')}
          hint={t('form.retryCountHint')}
          min={0}
          max={9}
          required={false}
          value={values.retryCount}
          onChange={(value) => update('retryCount', value)}
        />
        <NumberField
          id="job-timeout"
          label={t('form.timeout')}
          hint={t('form.timeoutHint')}
          min={60}
          max={604800}
          value={values.timeoutSeconds}
          onChange={(value) => update('timeoutSeconds', value)}
        />
      </div>
    </details>
  );
}
