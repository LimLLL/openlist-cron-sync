// 统一文本/数字输入字段，匹配暗色观测站主题。
import type { ComponentProps, ReactNode } from 'react';

/** 输入字段属性。 */
type InputFieldProps = Omit<ComponentProps<'input'>, 'className'> & {
  /** 关联标签。 */
  label: string;
  /** 可选提示。 */
  hint?: string;
  /** 行内错误。 */
  error?: string | null;
  /** 输入框右侧的附加操作（如浏览按钮），不影响标签与提示的关联。 */
  action?: ReactNode;
};

/** 渲染带标签的输入字段。
 * @param props 标签、提示、可选右侧操作和原生 input 属性。
 * @returns 表单字段。
 * @throws 不适用。
 */
export function InputField({
  id,
  label,
  hint,
  error,
  action,
  ...props
}: InputFieldProps) {
  const input = (
    <input
      {...props}
      id={id}
      className="field-input"
      aria-describedby={hint ? `${id}-hint` : undefined}
      aria-invalid={error ? true : undefined}
    />
  );
  return (
    <div className="space-y-2">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {action ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{input}</div>
          {action}
        </div>
      ) : (
        input
      )}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
