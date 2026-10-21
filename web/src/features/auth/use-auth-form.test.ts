// 保留 hook 的表单状态后重新渲染，验证语言切换无需再次提交或重发认证请求。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { useAuthForm } from './use-auth-form';

const hook = vi.hoisted(() => ({ states: [] as unknown[], index: 0 }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => {
    const index = hook.index++;
    if (!(index in hook.states)) hook.states[index] = initial;
    return [
      hook.states[index],
      (value: unknown) => {
        hook.states[index] = value;
      },
    ];
  },
}));
vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: i18n.getFixedT(i18n.language, 'auth') }),
}));

/** 按相同 hook 顺序重新读取表单状态。
 * @returns 真实认证表单 hook 的操作和错误。
 * @throws 不适用。
 */
function render() {
  hook.index = 0;
  return useAuthForm();
}

beforeEach(async () => {
  hook.states = [];
  await i18n.changeLanguage('en');
});

describe('auth form validation language', () => {
  it.each(['username', 'passwordLength', 'mismatch'] as const)(
    'retranslates an existing %s error and never submits invalid credentials',
    async (key) => {
      const action = vi.fn();
      await render().submit(action, key);
      const english = render().error?.message;
      await i18n.changeLanguage('zh');
      expect(render().error?.message).toBe(i18n.t(`auth:validation.${key}`));
      expect(render().error?.message).not.toBe(english);
      expect(action).not.toHaveBeenCalled();
    },
  );
});
