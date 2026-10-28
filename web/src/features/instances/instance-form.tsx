// 实例创建/编辑表单：基本信息、认证、传输三个分区；本地校验与最小补丁由 instance-form-model 负责。
import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Section } from '../../components/page';
import { ErrorState } from '../../components/states';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { PasswordField } from '../../components/ui/password-field';
import { Segmented } from '../../components/ui/segmented';
import { buildInstanceInput, InstanceFormError } from './instance-form-model';
import type { Instance, InstanceInput } from './instance-contract';

/** 表单属性。 */
interface InstanceFormProps {
  /** 编辑时的现有实例；创建时省略。 */
  instance?: Instance;
  /** 通过本地校验后的请求体。 */
  onSubmit: (data: InstanceInput) => void;
  /** 取消回调。 */
  onCancel: () => void;
  /** 请求进行中。 */
  pending: boolean;
  /** 服务端错误。 */
  error: Error | null;
}

/** 渲染实例表单。
 * @param props 现有实例、提交与取消回调、请求状态。
 * @returns 表单。
 * @throws 不适用；校验错误显示在表单内。
 */
export function InstanceForm({
  instance,
  onSubmit,
  onCancel,
  pending,
  error,
}: InstanceFormProps) {
  const { t } = useTranslation(['instances', 'common']);
  const [name, setName] = useState(instance?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(instance?.baseUrl ?? '');
  const [authMode, setAuthMode] = useState<'token' | 'password'>(
    instance?.auth.mode ?? 'token',
  );
  const [username, setUsername] = useState(instance?.auth.username ?? '');
  const [secret, setSecret] = useState('');
  const [downloadMode, setDownloadMode] = useState<'d' | 'p'>(
    instance?.downloadMode ?? 'd',
  );
  const [invalid, setInvalid] = useState<InstanceFormError | null>(null);
  // 新建、换认证方式或换密码模式用户名时必须重新填写凭据。
  const authChanged =
    !instance ||
    authMode !== instance.auth.mode ||
    (authMode === 'password' && username !== instance.auth.username);

  /** 本地校验后提交；校验失败时显示对应文案。
   * @param event 表单提交事件。
   * @returns 不适用。
   * @throws 不适用。
   */
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    try {
      const body = buildInstanceInput(
        { name, baseUrl, authMode, username, secret, downloadMode },
        instance,
      );
      setInvalid(null);
      onSubmit(body);
    } catch (failure) {
      setInvalid(
        failure instanceof InstanceFormError
          ? failure
          : new InstanceFormError('invalid'),
      );
    }
  };

  return (
    <form
      onSubmit={submit}
      aria-label={t('form.label')}
      className="max-w-2xl space-y-4"
    >
      <Section title={t('form.sections.identity')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="instance-name" label={t('form.name')}>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('form.namePlaceholder')}
              required
              maxLength={100}
              autoFocus={!instance}
            />
          </Field>
          <Field
            id="instance-url"
            label={t('form.baseUrl')}
            hint={t('form.baseUrlHint')}
          >
            <Input
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={t('form.baseUrlPlaceholder')}
              required
              translate="no"
            />
          </Field>
        </div>
      </Section>

      <Section
        title={t('form.sections.auth')}
        description={t('form.sections.authHint')}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium">{t('form.mode')}</p>
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
          <div className="grid gap-4 sm:grid-cols-2">
            {authMode === 'password' && (
              <Field id="instance-username" label={t('form.username')}>
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </Field>
            )}
            <PasswordField
              id="instance-secret"
              name="secret"
              label={
                !instance
                  ? t('form.secret')
                  : authChanged
                    ? t('form.secretRequired')
                    : t('form.secretOptional')
              }
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              autoComplete="off"
              required={authChanged}
              hint={
                !authChanged
                  ? t('form.secretKeep')
                  : authMode === 'token'
                    ? t('form.tokenHint')
                    : t('form.passwordHint')
              }
            />
          </div>
        </div>
      </Section>

      <Section title={t('form.sections.transfer')}>
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium">{t('form.downloadMode')}</p>
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
      </Section>

      {invalid && (
        <ErrorState error={new Error(t(`validation.${invalid.key}`))} />
      )}
      {error && <ErrorState error={error} />}
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onCancel} disabled={pending}>
          {t('common:actions.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? t('common:actions.saving')
            : instance
              ? t('form.save')
              : t('form.create')}
        </Button>
      </div>
    </form>
  );
}
