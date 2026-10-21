// 验证实例编辑不会要求重填未变更凭据，也不会静默丢弃认证修改。
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PasswordField } from '../../components/ui/password-field';
import { buildInstanceInput } from './instance-form-model';
import type { InstanceFormValues } from './instance-form-model';
import type { Instance } from './instance-contract';

const existing: Instance = {
  id: 'instance',
  name: 'Original',
  baseUrl: 'https://files.example',
  auth: { mode: 'password', username: 'admin', hasSecret: true },
  limits: {
    maxApiConcurrency: 4,
    apiRequestsPerSecond: 5,
    maxOutstandingTasks: 4,
    maxDownloadConnections: 2,
    maxUploadSessions: 2,
    maxChunkConcurrency: 4,
  },
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
    limits: { ...existing.limits },
  };
}

describe('instance editing', () => {
  it('sends only a name change without replacing auth or stale quotas', () => {
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
  it('rejects credential-bearing URLs and fractional limits', () => {
    expect(() =>
      buildInstanceInput(
        { ...fixture(), baseUrl: 'https://user:secret@files.example' },
        existing,
      ),
    ).toThrow('urlParts');
    expect(() =>
      buildInstanceInput(
        { ...fixture(), limits: { maxApiConcurrency: 1.5 } },
        existing,
      ),
    ).toThrow('limit');
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
