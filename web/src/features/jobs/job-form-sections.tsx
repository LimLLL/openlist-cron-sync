// 任务表单的编辑式分节：基本信息、源、定时、过滤规则与高级设置（目标列表见 job-target-fields）。
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EditorialSection } from '../../components/ui/editorial-section';
import { InputField } from '../../components/ui/input-field';
import { SelectField } from '../../components/ui/select-field';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { BrowseButton, SwitchRow } from './job-ui';
import type { Instance } from '../instances/instance-contract';
import type { JobFormValues } from './job-form-model';

/** 按字段更新表单值。
 * @template K 字段名。
 */
export type UpdateField = <K extends keyof JobFormValues>(
  field: K,
  value: JobFormValues[K],
) => void;

/** 各分节共用的属性。 */
interface SectionProps {
  /** 当前表单值。 */
  values: JobFormValues;
  /** 字段更新函数。 */
  update: UpdateField;
}

/** 渲染基本信息分节：任务名称。
 * @param props 表单值与更新函数。
 * @returns 分节。
 * @throws 不适用。
 */
export function BasicsFields({ values, update }: SectionProps) {
  const { t } = useTranslation('jobs');
  return (
    <EditorialSection
      index="01"
      title={t('form.basics')}
      description={t('form.basicsDesc')}
    >
      <div className="grid gap-6">
        <InputField
          id="job-name"
          label={t('form.name')}
          value={values.name}
          onChange={(event) => update('name', event.target.value)}
          required
          maxLength={100}
          placeholder={t('form.namePlaceholder')}
        />
      </div>
    </EditorialSection>
  );
}

/** 渲染源分节：实例、路径、路径密码、刷新开关与源下载并发。
 * @param props 表单值、更新函数、实例列表、是否编辑与打开目录选择器的回调。
 * @returns 分节。
 * @throws 不适用。
 */
export function SourceFields({
  values,
  update,
  instances,
  isEdit,
  onBrowse,
}: SectionProps & {
  instances: Instance[];
  isEdit: boolean;
  onBrowse: () => void;
}) {
  const { t } = useTranslation('jobs');
  return (
    <EditorialSection
      index="02"
      title={t('form.source')}
      description={t('form.sourceDesc')}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <SelectField
          id="source-instance"
          label={t('form.instance')}
          value={values.sourceInstanceId}
          onChange={(event) => update('sourceInstanceId', event.target.value)}
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
          id="source-path"
          label={t('form.path')}
          value={values.sourcePath}
          onChange={(event) => update('sourcePath', event.target.value)}
          required
          placeholder="/"
          hint={t('form.pathHint')}
          action={
            <BrowseButton
              disabled={!values.sourceInstanceId}
              onClick={onBrowse}
            />
          }
        />
        <InputField
          id="source-password"
          label={t('form.pathPassword')}
          type="password"
          autoComplete="off"
          value={values.sourcePassword}
          onChange={(event) => update('sourcePassword', event.target.value)}
          hint={isEdit ? t('form.keepPassword') : t('form.optional')}
        />
        <SwitchRow
          className="self-end"
          label={t('form.refreshSource')}
          hint={t('form.refreshHint')}
          checked={values.sourceRefresh}
          onChange={(checked) => update('sourceRefresh', checked)}
        />
        <InputField
          id="source-download-concurrency"
          label={t('form.sourceDownloadConcurrency')}
          type="number"
          inputMode="numeric"
          min={0}
          required
          value={values.sourceDownloadConcurrency}
          onChange={(event) =>
            update('sourceDownloadConcurrency', event.target.value)
          }
          hint={t('form.sourceDownloadConcurrencyHint')}
        />
        <InputField
          id="source-scan-interval"
          label={t('form.sourceScanInterval')}
          type="number"
          inputMode="numeric"
          min={0}
          max={3600}
          required
          value={values.sourceScanIntervalSeconds}
          onChange={(event) =>
            update('sourceScanIntervalSeconds', event.target.value)
          }
          hint={t('form.sourceScanIntervalHint')}
        />
      </div>
    </EditorialSection>
  );
}

/** 渲染定时分节：Cron 与时区。
 * @param props 表单值与更新函数。
 * @returns 分节。
 * @throws 不适用。
 */
export function ScheduleFields({ values, update }: SectionProps) {
  const { t } = useTranslation('jobs');
  return (
    <EditorialSection
      index="04"
      title={t('form.schedule')}
      description={t('form.scheduleDesc')}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <InputField
          id="cron"
          label={t('form.cron')}
          value={values.cron}
          onChange={(event) => update('cron', event.target.value)}
          placeholder="0 3 * * *"
          spellCheck={false}
          hint={t('form.cronHint')}
        />
        <InputField
          id="timezone"
          label={t('form.timezone')}
          value={values.timezone}
          onChange={(event) => update('timezone', event.target.value)}
          placeholder="UTC"
          spellCheck={false}
          hint={t('form.timezoneHint')}
        />
      </div>
    </EditorialSection>
  );
}

/** 渲染一个多行 glob 规则输入。
 * @param props id、标签、提示、值、占位与更新回调。
 * @returns 文本域字段。
 * @throws 不适用。
 */
function PatternField({
  id,
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="field-input min-h-28 resize-y font-mono text-[13px] leading-6"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        rows={4}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** 渲染过滤规则分节：包含/排除规则与大小范围。
 * @param props 表单值与更新函数。
 * @returns 分节。
 * @throws 不适用。
 */
export function FilterFields({ values, update }: SectionProps) {
  const { t } = useTranslation('jobs');
  return (
    <EditorialSection
      index="05"
      title={t('form.filters')}
      description={t('form.filtersDesc')}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <PatternField
          id="include-patterns"
          label={t('form.include')}
          hint={t('form.includeHint')}
          value={values.includePatterns}
          placeholder={'*.jpg\ndocs/**'}
          onChange={(value) => update('includePatterns', value)}
        />
        <PatternField
          id="exclude-patterns"
          label={t('form.exclude')}
          hint={t('form.excludeHint')}
          value={values.excludePatterns}
          placeholder={'*.tmp\n.cache/**'}
          onChange={(value) => update('excludePatterns', value)}
        />
        <InputField
          id="min-size"
          label={t('form.minSize')}
          type="number"
          min={0}
          value={values.minSizeBytes}
          onChange={(event) => update('minSizeBytes', event.target.value)}
          hint={t('form.noLimit')}
        />
        <InputField
          id="max-size"
          label={t('form.maxSize')}
          type="number"
          min={0}
          value={values.maxSizeBytes}
          onChange={(event) => update('maxSizeBytes', event.target.value)}
          hint={t('form.noLimit')}
        />
      </div>
    </EditorialSection>
  );
}

/** 渲染高级设置分节，默认收起以减少干扰。
 * @param props 表单值与更新函数。
 * @returns 分节。
 * @throws 不适用。
 */
export function AdvancedFields({ values, update }: SectionProps) {
  const { t } = useTranslation('jobs');
  const [open, setOpen] = useState(false);
  return (
    <EditorialSection
      index="06"
      title={t('form.advanced')}
      description={t('form.advancedDesc')}
    >
      <Button
        variant="secondary"
        size="sm"
        aria-expanded={open}
        aria-controls="job-advanced-fields"
        onClick={() => setOpen(!open)}
      >
        {open ? t('form.hideAdvanced') : t('form.showAdvanced')}
        <ChevronDown
          size={15}
          className={cn(
            'transition-transform duration-300',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </Button>
      {open && (
        <div
          id="job-advanced-fields"
          className="mt-6 grid gap-6 sm:grid-cols-2"
        >
          <SwitchRow
            label={t('form.allowEmptySource')}
            hint={t('form.allowEmptySourceHint')}
            checked={values.allowEmptySource}
            onChange={(checked) => update('allowEmptySource', checked)}
          />
          <SwitchRow
            label={t('form.syncEmptyDirs')}
            hint={t('form.syncEmptyDirsHint')}
            checked={values.syncEmptyDirs}
            onChange={(checked) => update('syncEmptyDirs', checked)}
          />
          <InputField
            id="bandwidth-limit"
            label={t('form.bandwidth')}
            type="number"
            min={0}
            value={values.relayBandwidthLimit}
            onChange={(event) =>
              update('relayBandwidthLimit', event.target.value)
            }
            hint={t('form.bandwidthHint')}
          />
          <InputField
            id="retry-count"
            label={t('form.retryCount')}
            type="number"
            min={0}
            max={9}
            value={values.retryCount}
            onChange={(event) => update('retryCount', event.target.value)}
            hint={t('form.retryCountHint')}
          />
          <InputField
            id="timeout"
            label={t('form.timeout')}
            type="number"
            min={60}
            max={604800}
            value={values.timeoutSeconds}
            onChange={(event) => update('timeoutSeconds', event.target.value)}
            hint={t('form.timeoutHint')}
          />
        </div>
      )}
    </EditorialSection>
  );
}
