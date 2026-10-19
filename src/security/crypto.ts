// 实现绑定记录身份的 AES-256-GCM 加解密。
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { decodeBase64 } from '../configuration/validation.js';
import { StartupError } from '../common/errors.js';
import type { EncryptedValue } from '../database/encrypted-columns.js';

/** AAD 身份；table、recordId、field 分别为 SQL 表名、记录 ID 和字段名。 */
export type CipherIdentity = Pick<
  EncryptedValue,
  'table' | 'recordId' | 'field'
>;

/** 生成不可跨记录搬移的附加认证数据。
 * @param identity 密文字段身份。
 * @returns UTF-8 AAD。
 * @throws 不适用。
 */
function aad(identity: CipherIdentity): Buffer {
  return Buffer.from(
    `${identity.table}:${identity.recordId}:${identity.field}:v1`,
    'utf8',
  );
}

/** 用随机 nonce 加密一个秘密。
 * @param key 32 字节主密钥。
 * @param plaintext 原始秘密。
 * @param identity AAD 身份。
 * @returns v1 JSON ENC 封装。
 * @throws Error 密钥或底层加密操作失败。
 */
export function encrypt(
  key: Buffer,
  plaintext: string,
  identity: CipherIdentity,
): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, {
    authTagLength: 16,
  });
  cipher.setAAD(aad(identity));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return JSON.stringify({
    v: 1,
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

/** 解密并严格验证 ENC 封装和 AAD。
 * @param key 32 字节主密钥。
 * @param value 原始 ENC。
 * @param identity AAD 身份。
 * @returns 明文。
 * @throws StartupError 密钥、格式、tag 或 AAD 不匹配，统一为 KEY_MISMATCH。
 */
export function decrypt(
  key: Buffer,
  value: string,
  identity: CipherIdentity,
): string {
  try {
    const envelope: unknown = JSON.parse(value);
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      !('v' in envelope) ||
      envelope.v !== 1 ||
      !('nonce' in envelope) ||
      typeof envelope.nonce !== 'string' ||
      !('tag' in envelope) ||
      typeof envelope.tag !== 'string' ||
      !('ciphertext' in envelope) ||
      typeof envelope.ciphertext !== 'string' ||
      Object.keys(envelope).length !== 4
    )
      throw new Error('Invalid envelope');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      decodeBase64(envelope.nonce, 12),
      { authTagLength: 16 },
    );
    decipher.setAAD(aad(identity));
    decipher.setAuthTag(decodeBase64(envelope.tag, 16));
    return Buffer.concat([
      decipher.update(decodeBase64(envelope.ciphertext)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new StartupError(
      'KEY_MISMATCH',
      'Cannot decrypt existing ciphertext',
    );
  }
}

/** 在允许加密新数据之前验证全部已有密文。
 * @param key 主密钥。
 * @param values 流式密文输入。
 * @returns 不适用。
 * @throws StartupError 任一密文不匹配。
 */
export function verifyCiphertexts(
  key: Buffer,
  values: Iterable<EncryptedValue>,
): void {
  for (const value of values) decrypt(key, value.value, value);
}
