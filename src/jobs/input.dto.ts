// 保留 Job 请求的显式 DTO 白名单，嵌套合并和完整校验由配置入口完成。
import { Allow } from 'class-validator';

/** 创建与 PATCH 共同的外层白名单，未知字段由 ValidationPipe 拒绝。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class JobInputDto {
  /** 展示名，创建必填。 */
  @Allow() name?: unknown;
  /** 源完整对象或 PATCH。 */
  @Allow() source?: unknown;
  /** 完整目标集合或省略保留。 */
  @Allow() targets?: unknown;
  /** relay/server_copy。 */
  @Allow() createMode?: unknown;
  /** 启用值，M2 无调度作用。 */
  @Allow() enabled?: unknown;
  /** 五段 cron 或 null。 */
  @Allow() cron?: unknown;
  /** IANA 时区。 */
  @Allow() timezone?: unknown;
  /** 按字段合并的过滤器。 */
  @Allow() filters?: unknown;
  /** 完整空源授权。 */
  @Allow() allowEmptySource?: unknown;
  /** 目录结构同步。 */
  @Allow() syncEmptyDirs?: unknown;
  /** 上传 bytes/s。 */
  @Allow() relayBandwidthLimit?: unknown;
  /** 扫描及规划总秒数。 */
  @Allow() timeoutSeconds?: unknown;
  /** M2 只能省略或为空。 */
  @Allow() notificationChannelIds?: unknown;
}
