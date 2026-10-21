// 统一文本/数字输入字段，匹配暗色观测站主题。
import type { ComponentProps } from 'react';

/** 输入字段属性。 */
type InputFieldProps = Omit<ComponentProps<'input'>, 'className'> & {
  /** 关联标签。 */
  label: string;
  /** 可选提示。 */
  hint?: string;
  /** 行内错误。 */
  error?: string | null;
};

/** 渲染带标签的输入字段。
 * @param props 标签、提示和原生 input 属性。
 * @returns 表单字段。
 * @throws 不适用。
 */
export function InputField({ id, label, hint, error, ...props }: InputFieldProps) {
  return (
    <div className="space-y-2">
      <label className="field-label" htmlFor={id}>{label}</label>
      <input
        {...props}
        id={id}
        className="field-input"
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-invalid={error ? true : undefined}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}
    </div>
  );
}
