// 验证密码 Unicode 边界和认证响应，防止无效会话进入 UI。
import { describe, expect, it } from 'vitest';
import { parseAdministrator, parseLogin, passwordError } from './auth-contract';

describe('authentication contracts', () => {
  it('counts Unicode code points like the backend without trimming passwords', () => {
    const character = String.fromCodePoint(0x10400);
    expect(passwordError(character.repeat(11))).not.toBeNull();
    expect(passwordError(character.repeat(12))).toBeNull();
    expect(passwordError(character.repeat(128))).toBeNull();
    expect(passwordError(character.repeat(129))).not.toBeNull();
    expect(passwordError(' spaced password ')).toBeNull();
  });

  it('preserves the forced-password-change state', () => {
    expect(
      parseLogin({
        accessToken: 'token',
        tokenType: 'Bearer',
        expiresIn: 300,
        mustChangePassword: true,
      }).mustChangePassword,
    ).toBe(true);
    expect(
      parseAdministrator({ id: 1, username: 'admin', mustChangePassword: true })
        .mustChangePassword,
    ).toBe(true);
  });

  it('rejects missing or invalid authentication fields', () => {
    for (const value of [
      null,
      {},
      {
        accessToken: '',
        tokenType: 'Bearer',
        expiresIn: 300,
        mustChangePassword: false,
      },
      {
        accessToken: 'token',
        tokenType: 'Bearer',
        expiresIn: -1,
        mustChangePassword: false,
      },
    ])
      expect(() => parseLogin(value)).toThrow('invalid session');
    expect(() =>
      parseAdministrator({
        id: 2,
        username: 'admin',
        mustChangePassword: false,
      }),
    ).toThrow('invalid administrator');
  });
});
