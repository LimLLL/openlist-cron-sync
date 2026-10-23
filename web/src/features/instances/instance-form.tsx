// 实例创建/编辑表单：按标识、认证、传输、配额四个编辑式分节组织，表单 id 允许顶栏按钮提交。
import { useState } from 'react';
import type { FormEvent } from 'react';
import { LoaderCircle, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { InputField } from '../../components/ui/input-field';
import { PasswordField } from '../../components/ui/password-field';
import { Segmented } from '../../components/ui/segmented';
import { EditorialSection } from '../../components/ui/editorial-section';
import { ErrorState } from '../../components/states';
import { buildInstanceInput, InstanceFormError } from './instance-form-model';
import { LIMIT_FIELDS } from './instance-display';
import type {
  Instance,
  InstanceInput,
  InstanceLimits,
} from './instance-contract';

/** 表单属性。 */
interface InstanceFormProps {
  /** 编辑时的现有数据；创建时 undefined。 */
  instance?: Instance;
  /** 提交处理。 */
  onSubmit: (data: InstanceInput) => void;
  /** 是否正在提交。 */
  pending: boolean;
  /** 提交错误。 */
  error: Error | null;
  /** 表单 id，顶栏按钮通过 form 属性提交。 */
  formId: string;
  /** 编辑模式的取消回调；创建页不提供。 */
  onCancel?: () => void;
}

/** 渲染实例创建/编辑表单。
 * @param props 现有数据、提交方法、状态与表单 id。
 * @returns 实例表单。
 * @throws 不适用。
 */
export function InstanceForm({
  instance,
  onSubmit,
  pending,
  error,
  formId,
  onCancel,
}: InstanceFormProps) {
  const { t } = useTranslation(['instances', 'common']);
  const [name, setName] = useState(instance?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(instance?.baseUrl ?? '');
  const [authMode, setAuthMode] = useState<'token' | 'password'>(
    instance?.auth.mode ?? 'token',
  );
  const [username, setUsername] = useState(instance?.auth.username ?? '');
  const [secret, setSecret] = useState('');
  const [validationError, setValidationError] = useState<Error | null>(null);
  const authChanged =
    !instance ||
    authMode !== instance.auth.mode ||
    (authMode === 'password' && username !== instance.auth.username);
  const [downloadMode, setDownloadMode] = useState<'d' | 'p'>(
    instance?.downloadMode ?? 'd',
  );
  const [limits, setLimits] = useState<Partial<InstanceLimits>>({
    maxApiConcurrency: instance?.limits.maxApiConcurrency,
    apiRequestsPerSecond: instance?.limits.apiRequestsPerSecond,
  });

  /** 构建请求体并提交。
   * @param event 表单事件。
   * @returns 不适用。
   * @throws 不适用。
   */
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    try {
      const body = buildInstanceInput(
        { name, baseUrl, authMode, username, secret, downloadMode, limits },
        instance,
      );
      setValidationError(null);
      onSubmit(body);
    } catch (failure) {
      setValidationError(
        failure instanceof Error ? failure : new InstanceFormError('invalid'),
      );
    }
  }

  /** 按当前语言翻译本地校验错误；渲染时翻译，切换语言后文案同步更新。
   * @param failure 校验阶段捕获的错误。
   * @returns 可交给 ErrorState 的错误。
   * @throws 不适用。
   */
  function localize(failure: Error): Error {
    if (!(failure instanceof InstanceFormError)) return failure;
    if (failure.key === 'limit' && failure.limit)
      return new Error(
        t('validation.limit', { field: t(`limits.${failure.limit.field}`) }),
      );
    return failure.key === 'limit'
      ? new Error(t('validation.invalid'))
      : new Error(t(`validation.${failure.key}`));
  }

  /** 更新单个配额字段；空字符串表示使用默认值。
   * @param key 配额字段名。
   * @param value 输入框原始值。
   * @returns 不适用。
   * @throws 不适用。
   */
  function setLimit(key: keyof InstanceLimits, value: string) {
    const parsed = value === '' ? undefined : Number(value);
    setLimits((prev) => ({ ...prev, [key]: parsed }));
  }

  return (
    <form id={formId} onSubmit={handleSubmit} aria-label={t('form.label')}>
      <EditorialSection
        index="01"
        title={t('form.sections.identity')}
        description={t('form.sections.identityHint')}
      >
        <div className="grid gap-6 md:grid-cols-2">
          <InputField
            id={`${formId}-name`}
            label={t('form.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('form.namePlaceholder')}
            required
            minLength={1}
            maxLength={100}
            autoFocus={!instance}
          />
          <InputField
            id={`${formId}-url`}
            label={t('form.baseUrl')}
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={t('form.baseUrlPlaceholder')}
            hint={t('form.baseUrlHint')}
            required
          />
        </div>
      </EditorialSection>

      <EditorialSection
        index="02"
        title={t('form.sections.auth')}
        description={t('form.sections.authHint')}
      >
        <div className="space-y-6">
          <div className="space-y-2.5">
            <p className="field-label">{t('form.mode')}</p>
            <Segmented
              label={t('form.mode')}
              value={authMode}
              onChange={setAuthMode}
              options={[
                { value: 'token', label: t('form.modeToken') },
                { value: 'password', label: t('form.modePassword') },
              ]}
            />
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {authMode === 'password' && (
              <InputField
                id={`${formId}-username`}
                label={t('form.username')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="off"
              />
            )}
            <PasswordField
              id={`${formId}-secret`}
              name="secret"
              label={
                !instance
                  ? t('form.secret')
                  : authChanged
                    ? t('form.secretRequired')
                    : t('form.secretOptional')
              }
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
              required={authChanged}
              hint={
                authMode === 'token'
                  ? t('form.tokenHint')
                  : t('form.passwordHint')
              }
            />
          </div>
        </div>
      </EditorialSection>

      <EditorialSection
        index="03"
        title={t('form.sections.transfer')}
        description={t('form.sections.transferHint')}
      >
        <div className="space-y-3">
          <p className="field-label">{t('form.downloadMode')}</p>
          <Segmented
            label={t('form.downloadMode')}
            value={downloadMode}
            onChange={setDownloadMode}
            options={[
              { value: 'd', label: t('form.downloadDirect') },
              { value: 'p', label: t('form.downloadProxy') },
            ]}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {downloadMode === 'd'
              ? t('form.downloadDirectHint')
              : t('form.downloadProxyHint')}
          </p>
        </div>
      </EditorialSection>

      <EditorialSection
        index="04"
        title={t('form.sections.limits')}
        description={t('form.sections.limitsHint')}
      >
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          {LIMIT_FIELDS.map((field) => (
            <InputField
              key={field.key}
              id={`${formId}-limit-${field.key}`}
              label={t(`limits.${field.key}`)}
              type="number"
              inputMode="numeric"
              min={0}
              value={limits[field.key] ?? ''}
              onChange={(e) => setLimit(field.key, e.target.value)}
              placeholder={String(field.defaultValue)}
              hint={t('form.limitHint', { value: field.defaultValue })}
            />
          ))}
        </div>
      </EditorialSection>

      <div className="space-y-4 border-t border-hairline pt-8">
        {validationError && <ErrorState error={localize(validationError)} />}
        {error && <ErrorState error={error} />}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} disabled={pending}>
              {t('common:actions.cancel')}
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? (
              <LoaderCircle
                size={16}
                className="motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Save size={16} aria-hidden="true" />
            )}
            {pending
              ? t('common:actions.saving')
              : instance
                ? t('form.save')
                : t('form.create')}
          </Button>
        </div>
      </div>
    </form>
  );
}
