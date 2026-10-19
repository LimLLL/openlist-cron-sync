// 定义实例公共响应，所有可空字段显式返回 null。
import { ApiProperty } from '@nestjs/swagger';

/** 所有有效实例配额。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class LimitsView {
  /** 有效值，默认 4，范围 1–32。 */
  @ApiProperty({ type: 'integer', default: 4, minimum: 1, maximum: 32 })
  maxApiConcurrency: number;
  /** 有效值，默认 5，范围 1–100。 */
  @ApiProperty({ type: 'integer', default: 5, minimum: 1, maximum: 100 })
  apiRequestsPerSecond: number;
  /** 有效值，默认 4，范围 1–64。 */
  @ApiProperty({ type: 'integer', default: 4, minimum: 1, maximum: 64 })
  maxOutstandingTasks: number;
  /** 有效值，默认 2，范围 1–16。 */
  @ApiProperty({ type: 'integer', default: 2, minimum: 1, maximum: 16 })
  maxDownloadConnections: number;
  /** 有效值，默认 2，范围 1–16。 */
  @ApiProperty({ type: 'integer', default: 2, minimum: 1, maximum: 16 })
  maxUploadSessions: number;
  /** 有效值，默认 4，范围 1–32。 */
  @ApiProperty({ type: 'integer', default: 4, minimum: 1, maximum: 32 })
  maxChunkConcurrency: number;
}

/** 凭据状态，不包含原文或密文。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class AuthView {
  /** 认证方式。 */
  @ApiProperty({ enum: ['token', 'password'] })
  mode: 'token' | 'password';
  /** password 用户名；token 时 null。 */
  @ApiProperty({ type: String, nullable: true })
  username: string | null;
  /** 是否已保存凭据。 */
  @ApiProperty({})
  hasSecret: boolean;
}

/** 固定原因码与服务生成摘要。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class DiagnosticView {
  /** 固定原因码。 */
  @ApiProperty({})
  code: string;
  /** 无秘密摘要，最多 2048 字符。 */
  @ApiProperty({ maxLength: 2048 })
  message: string;
}

/** 实例公共视图，禁止扩散实体字段。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class InstanceView {
  /** UUIDv4。 */
  @ApiProperty({ format: 'uuid' })
  id: string;
  /** 创建 UTC 时间。 */
  @ApiProperty({ format: 'date-time' })
  createdAt: string;
  /** 更新时间。 */
  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
  /** 1–100 字符名称。 */
  @ApiProperty({ minLength: 1, maxLength: 100 })
  name: string;
  /** 规范化地址。 */
  @ApiProperty({ format: 'uri' })
  baseUrl: string;
  /** 认证公开视图。 */
  @ApiProperty({ type: AuthView })
  auth: AuthView;
  /** 全部有效配额。 */
  @ApiProperty({ type: LimitsView })
  limits: LimitsView;
  /** 下载模式。 */
  @ApiProperty({ enum: ['d', 'p'] })
  downloadMode: 'd' | 'p';
  /** 认证状态。 */
  @ApiProperty({ enum: ['untested', 'ready', 'auth_blocked'] })
  authState: 'untested' | 'ready' | 'auth_blocked';
  /** 已确认值；尚无记录时 null。 */
  @ApiProperty({ type: String, nullable: true })
  authBlockReason: string | null;
  /** 已确认值；尚无记录时 null。 */
  @ApiProperty({ type: String, nullable: true })
  accountUsername: string | null;
  /** 已确认值；尚无记录时 null。 */
  @ApiProperty({ type: String, nullable: true })
  accountBasePath: string | null;
  /** 已确认值；尚无记录时 null。 */
  @ApiProperty({ type: String, nullable: true })
  openlistVersion: string | null;
  /** UTC 时间；未设置时 null。 */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  authBlockedUntil: string | null;
  /** UTC 时间；未设置时 null。 */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastTestAt: string | null;
  /** UTC 时间；未设置时 null。 */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  archivedAt: string | null;
  /** 上游原值；未连接时 null。 */
  @ApiProperty({ type: 'integer', nullable: true })
  accountRole: number | null;
  /** 上游原值；未连接时 null。 */
  @ApiProperty({ type: 'integer', nullable: true })
  accountPermissions: number | null;
  /** 最近测试能力；未测试时 null。 */
  @ApiProperty({ type: Boolean, nullable: true })
  multipartEnabled: boolean | null;
  /** 最近错误；无错误时 null。 */
  @ApiProperty({ type: DiagnosticView, nullable: true })
  lastError: DiagnosticView | null;
}

/** 实例分页结果。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class InstancePage {
  /** 当前页对象。 */
  @ApiProperty({ type: [InstanceView] })
  items: InstanceView[];
  /** 当前页。 */
  @ApiProperty({ type: 'integer' })
  page: number;
  /** 页大小。 */
  @ApiProperty({ type: 'integer' })
  pageSize: number;
  /** 符合查询的总数。 */
  @ApiProperty({ type: 'integer' })
  total: number;
}
