// 共用认证表单的请求生命周期，卸载时取消并防止重复提交。
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api-client';
import type en from '../../i18n/locales/en/auth';

/** 本地校验只保存键；切换语言时不需要重新提交表单。 */
type ValidationKey = keyof (typeof en)['validation'];

/** 管理直接提交的认证表单，避免密码进入 Query mutation 缓存。
 * @returns 提交入口、提交状态与安全错误。
 * @throws 不适用；提交错误转为表单状态。
 */
export function useAuthForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [validationKey, setValidationKey] = useState<ValidationKey | null>(
    null,
  );
  const { t } = useTranslation('auth');
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );

  /** 执行通过本地验证的操作，按表单生命周期处理取消。
   * @param action 接受取消信号的认证操作。
   * @param validation 本地校验文案键；没有时为 null。
   * @returns 完成处理，错误已显示在表单。
   * @throws 不适用。
   */
  async function submit(
    action: (signal: AbortSignal) => Promise<void>,
    validation: ValidationKey | null = null,
  ): Promise<void> {
    if (request.current) return;
    setError(null);
    setValidationKey(validation);
    if (validation) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      await action(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure
            : new ApiError(
                0,
                'HTTP_ERROR',
                'The request could not be completed.',
              ),
        );
    } finally {
      if (!controller.signal.aborted) setPending(false);
      if (request.current === controller) request.current = null;
    }
  }

  return {
    pending,
    error: validationKey ? new Error(t(`validation.${validationKey}`)) : error,
    submit,
  };
}
