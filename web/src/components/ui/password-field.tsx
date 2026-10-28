// 带显示/隐藏开关的密码输入，自带标签与说明；不持久化或规范化秘密。
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from './input';

/** 密码字段属性：原生 input 属性（除 type）加标签与说明。 */
type PasswordFieldProps = Omit<ComponentProps<'input'>, 'type'> & {
  /** 输入框 id。 */
  id: string;
  /** 字段标签。 */
  label: string;
  /** 输入框下方说明。 */
  hint?: string;
};

/** 渲染密码字段；默认必填，编辑时可传 required={false} 表示留空保留原值。
 * @param props 原生属性、标签与说明。
 * @returns 密码字段。
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
    <div className="min-w-0 space-y-1.5">
      <label className="text-[13px] font-medium" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <Input
          {...props}
          id={id}
          type={visible ? 'text' : 'password'}
          className="pr-9"
          aria-describedby={hint ? `${id}-hint` : undefined}
          required={required}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground"
          aria-label={t(visible ? 'password.hide' : 'password.show', {
            label,
          })}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? (
            <EyeOff size={15} aria-hidden="true" />
          ) : (
            <Eye size={15} aria-hidden="true" />
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
