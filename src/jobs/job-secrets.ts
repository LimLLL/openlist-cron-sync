// 解密配置路径密码，供合并补丁和独立运行快照使用。
import type { KeysService } from '../security/keys.service.js';
import type { JobRecord, TargetRecord } from '../database/job-schema.js';
import type { PathSecrets } from './job-types.js';

/** 解密 Job 路径密码，仅供补丁合并与创建运行快照。
 * @param keys 密钥服务。
 * @param job Job 记录。
 * @param targets 活动目标。
 * @returns 内存秘密，不返回 HTTP。
 * @throws Error 解密失败。
 */
export function decryptJobSecrets(
  keys: KeysService,
  job: JobRecord,
  targets: TargetRecord[],
): PathSecrets {
  const targetPasswords: Record<string, string | null> = {};
  for (const target of targets)
    targetPasswords[target.id] =
      target.passwordEnc === null
        ? null
        : keys.decrypt(target.passwordEnc, {
            table: 'job_targets',
            recordId: target.id,
            field: 'password_enc',
          });
  return {
    sourcePassword:
      job.sourcePasswordEnc === null
        ? null
        : keys.decrypt(job.sourcePasswordEnc, {
            table: 'jobs',
            recordId: job.id,
            field: 'source_password_enc',
          }),
    targetPasswords,
  };
}
