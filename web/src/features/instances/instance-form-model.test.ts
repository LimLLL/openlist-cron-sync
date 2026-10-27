// 验证实例编辑不会要求重填未变更凭据，也不会静默丢弃认证修改。
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PasswordField } from '../../components/ui/password-field';
import { buildInstanceInput } from './instance-form-model';
import type { InstanceFormValues } from './instance-form-model';
import { parseInstance } from './instance-contract';
import type { Instance } from './instance-contract';

const existing: Instance = {
  id: 'instance',
  name: 'Original',
  baseUrl: 'https://files.example',
  auth: { mode: 'password', username: 'admin', hasSecret: true },
  downloadMode: 'd',
  authState: 'ready',
  authBlockReason: null,
  accountUsername: 'admin',
  accountBasePath: '/',
  openlistVersion: '4.2.5',
  authBlockedUntil: null,
  lastTestAt: null,
  archivedAt: null,
  accountRole: 2,
  accountPermissions: 0,
  multipartEnabled: true,
  lastError: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

/** 生成编辑现有实例的表单值。
 * @returns 独立输入。
 * @throws 不适用。
 */
function fixture(): InstanceFormValues {
  return {
    name: existing.name,
    baseUrl: existing.baseUrl,
    authMode: 'password',
    username: 'admin',
    secret: '',
    downloadMode: 'd',
  };
}

describe('instance editing', () => {
  /** 新响应无需 limits；旧缓存中的同名字段不得进入新建或更新请求。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 解析或断言失败。
   */
  it('parses limits-free responses and never resends limits from stale browser data', () => {
    expect(parseInstance(existing)).toEqual(existing);
    const legacy = {
      ...existing,
      limits: { maxApiConcurrency: 4, apiRequestsPerSecond: 5 },
    };
    expect(parseInstance(legacy)).not.toHaveProperty('limits');
    const values = { ...fixture(), name: 'Renamed', limits: legacy.limits };
    expect(buildInstanceInput(values, legacy)).toEqual({ name: 'Renamed' });
    expect(buildInstanceInput({ ...values, secret: 'new-secret' })).toEqual({
      name: 'Renamed',
      baseUrl: existing.baseUrl,
      downloadMode: 'd',
      auth: { mode: 'password', username: 'admin', secret: 'new-secret' },
    });
  });

  it('sends only a name change without replacing auth', () => {
    expect(
      buildInstanceInput({ ...fixture(), name: 'Renamed' }, existing),
    ).toEqual({ name: 'Renamed' });
  });
  it('requires a new secret when the mode or username changes', () => {
    expect(() =>
      buildInstanceInput({ ...fixture(), username: 'other' }, existing),
    ).toThrow('authChange');
    expect(() =>
      buildInstanceInput({ ...fixture(), authMode: 'token' }, existing),
    ).toThrow('authChange');
    expect(
      buildInstanceInput(
        { ...fixture(), authMode: 'token', secret: 'new-token' },
        existing,
      ).auth,
    ).toEqual({ mode: 'token', secret: 'new-token' });
  });
  it('rejects credential-bearing URLs', () => {
    expect(() =>
      buildInstanceInput(
        { ...fixture(), baseUrl: 'https://user:secret@files.example' },
        existing,
      ),
    ).toThrow('urlParts');
  });
  it('reports no changes when every field matches the saved instance', () => {
    expect(() => buildInstanceInput(fixture(), existing)).toThrow('noChanges');
  });
  it('honours optional secret fields while keeping login passwords required', () => {
    expect(
      renderToStaticMarkup(
        createElement(PasswordField, {
          id: 'optional',
          label: 'Secret',
          required: false,
        }),
      ),
    ).not.toMatch(/\brequired=/);
    expect(
      renderToStaticMarkup(
        createElement(PasswordField, { id: 'required', label: 'Password' }),
      ),
    ).toMatch(/\brequired=/);
  });
});
