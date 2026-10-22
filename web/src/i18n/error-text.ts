// 把稳定错误码映射为当前语言文案；未知错误码回退到后端原文，不丢信息。
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from './index';
import errors from './locales/en/errors';

/** 已有翻译的错误码。 */
export type ErrorCode = keyof typeof errors;

/** 判断错误码是否有翻译。
 * @param code 后端或客户端错误码。
 * @returns 是否为已知错误码。
 * @throws 不适用。
 */
export function isKnownErrorCode(code: string): code is ErrorCode {
  return Object.hasOwn(errors, code);
}

/** 返回错误码的本地化文案。
 * @param code 错误码，可为空。
 * @param fallback 未知错误码时显示的原始信息。
 * @returns 本地化文案或原始信息。
 * @throws 不适用。
 */
export function errorText(
  code: string | null | undefined,
  fallback: string,
): string {
  return code && isKnownErrorCode(code) ? i18n.t(`errors:${code}`) : fallback;
}

/** 在组件中使用 errorText；t 随语言切换更新，使用方会同步重新渲染。
 * @returns 与 errorText 相同签名的函数。
 * @throws 不适用。
 */
export function useErrorText(): typeof errorText {
  const { t } = useTranslation('errors');
  return useCallback(
    (code: string | null | undefined, fallback: string) =>
      code && isKnownErrorCode(code) ? t(code) : fallback,
    [t],
  );
}
