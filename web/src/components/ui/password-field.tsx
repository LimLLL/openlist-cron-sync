// 提供带可访问显示开关的密码输入，不持久化或规范化秘密。
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** 密码字段属性。 */
type PasswordFieldProps = Omit<ComponentProps<'input'>, 'type'> & {
  /** 必填字段标识，用于关联标签。 */
  id: string;
  /** 可见标签。 */
  label: string;
  /** 可选的格式说明。 */
  hint?: string;
};

/** 渲染密码输入和键盘可操作的显示开关。
 * @param props 标签、原生输入属性及格式说明。
 * @returns 密码表单字段。
 * @throws 不适用。
 */
export function PasswordField({
  id,
  label,
  hint,
  required = true,
  ...props
}: PasswordFieldProps) {
  const { t } = useTranslation('common');
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-2">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          {...props}
          id={id}
          type={visible ? 'text' : 'password'}
          className="field-input pr-12"
          aria-describedby={hint ? `${id}-hint` : undefined}
          required={required}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-muted-foreground hover:text-foreground"
          aria-label={t(visible ? 'password.hide' : 'password.show', { label: label.toLowerCase() })}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? (
            <EyeOff size={17} aria-hidden="true" />
          ) : (
            <Eye size={17} aria-hidden="true" />
          )}
        </button>
      </div>
      {hint && (
        <p
          id={`${id}-hint`}
          className="text-xs leading-relaxed text-muted-foreground"
        >
          {hint}
        </p>
      )}
    </div>
  );
}
