// 按来源矩阵解析密钥，全部已有密文校验通过后才发布密钥。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { AppConfig } from '../configuration/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import {
  ENCRYPTED_COLUMNS,
  readEncryptedValues,
} from '../database/encrypted-columns.js';
import type { EncryptedColumn } from '../database/encrypted-columns.js';
import { StartupError } from '../common/errors.js';
import { decodeBase64 } from '../configuration/validation.js';
import { encrypt, decrypt, verifyCiphertexts } from './crypto.js';
import type { CipherIdentity } from './crypto.js';
import { readKeyFile, writeKeyFile } from './key-file.js';

/** 已验证的两把独立密钥。 */
interface KeyMaterial {
  /** JWT 签名密钥。 */
  jwt: Buffer;
  /** 静态加密主密钥。 */
  master: Buffer;
}

/** 启动密钥服务；未验证成功时不能加密或签发会话。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class KeysService {
  private material: KeyMaterial | undefined;
  private readonly logger = new Logger(KeysService.name);

  /** 保存初始化所需依赖。
   * @param config 应用配置。
   * @param database 已迁移的数据库。
   * @param columns 显式 ENC 清单，包含实例凭据。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ENCRYPTED_COLUMNS)
    private readonly columns: readonly EncryptedColumn[],
  ) {}

  /** 解析来源、验证已有密文、持久化生成密钥，最后发布密钥。
   * @param 不适用。
   * @returns 初始化完成的 Promise。
   * @throws StartupError 来源冲突、缺失主密钥、校验或文件失败。
   */
  async initialize(): Promise<void> {
    const path = join(this.config.dataDir, 'keys.json');
    const file = await readKeyFile(path);
    for (const [environment, stored] of [
      [this.config.jwtSecret, file.jwtSecret],
      [this.config.masterKey, file.encryptionMasterKey],
    ]) {
      if (
        environment !== undefined &&
        stored !== undefined &&
        environment !== stored
      )
        throw new StartupError(
          'CONFIG_KEY_CONFLICT',
          'Environment and keys file disagree',
        );
    }
    let master = this.config.masterKey ?? file.encryptionMasterKey;
    let jwt = this.config.jwtSecret ?? file.jwtSecret;
    let changed = false;
    if (master === undefined) {
      for (const _value of readEncryptedValues(
        this.database.db,
        this.columns,
      )) {
        // 包括空字符串在内的任何非 NULL 值都是已有 ENC，不能生成替代密钥。
        throw new StartupError(
          'KEY_MISMATCH',
          'Master key is missing for existing ciphertext',
        );
      }
      master = randomBytes(32).toString('base64');
      file.encryptionMasterKey = master;
      changed = true;
      this.logger.log('Generated master key; no existing ciphertext found', {
        decision: 'master_key_generated',
      });
    }
    const masterBytes = decodeBase64(master, 32);
    verifyCiphertexts(
      masterBytes,
      readEncryptedValues(this.database.db, this.columns),
    );
    if (jwt === undefined) {
      jwt = randomBytes(32).toString('base64');
      file.jwtSecret = jwt;
      changed = true;
      this.logger.warn(
        'Generated JWT key; existing administrative sessions are invalid',
        { decision: 'jwt_key_generated' },
      );
    }
    if (changed) await writeKeyFile(path, file);
    this.material = { master: masterBytes, jwt: decodeBase64(jwt, 32) };
  }

  /** 获取已验证 JWT 密钥。
   * @param 不适用。
   * @returns JWT 二进制密钥。
   * @throws Error 初始化未成功。
   */
  get jwtSecret(): Buffer {
    return this.readyKeys().jwt;
  }

  /** 加密一个具有明确存储身份的秘密。
   * @param plaintext 明文。
   * @param identity AAD 身份。
   * @returns ENC 字符串。
   * @throws Error 密钥初始化未成功或加密失败。
   */
  encrypt(plaintext: string, identity: CipherIdentity): string {
    return encrypt(this.readyKeys().master, plaintext, identity);
  }

  /** 解密指定字段。
   * @param value ENC 字符串。
   * @param identity AAD 身份。
   * @returns 明文。
   * @throws Error 初始化失败；StartupError 表示密文不匹配。
   */
  decrypt(value: string, identity: CipherIdentity): string {
    return decrypt(this.readyKeys().master, value, identity);
  }

  /** 拒绝初始化失败后的密钥使用。
   * @param 不适用。
   * @returns 已验证密钥。
   * @throws Error 初始化未成功。
   */
  private readyKeys(): KeyMaterial {
    if (!this.material) throw new Error('Keys are not initialized');
    return this.material;
  }
}
