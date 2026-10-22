// 下拉选择器，统一表单字段样式。
import type { ComponentProps } from 'react';

/** 选择器属性。 */
type SelectFieldProps = Omit<ComponentProps<'select'>, 'className'> & {
  /** 关联标签。 */
  label: string;
  /** 可选提示。 */
  hint?: string;
};

/** 渲染下拉选择表单字段。
 * @param props 标签和原生 select 属性。
 * @returns 表单字段。
 * @throws 不适用。
 */
export function SelectField({
  id,
  label,
  hint,
  children,
  ...props
}: SelectFieldProps) {
  return (
    <div className="space-y-2">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select
        {...props}
        id={id}
        className="field-input appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23a0aaa2%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-10"
      >
        {children}
      </select>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
