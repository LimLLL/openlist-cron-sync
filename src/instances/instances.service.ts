// 实现实例配置 CRUD 与公开投影，凭据只在 AES-GCM 字段中保存。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { instances } from '../database/schema.js';
import type { InstanceRecord, InstanceChanges } from '../database/schema.js';
import { KeysService } from '../security/keys.service.js';
import { ApiError } from '../common/errors.js';
import { OpenListClient } from '../openlist/client.service.js';
import { normalizeBaseUrl } from '../openlist/paths.js';
import type {
  AuthInputDto,
  InstanceCreateDto,
  InstancePatchDto,
  InstanceQueryDto,
} from './input.dto.js';
import type { InstanceView, InstancePage } from './view.dto.js';

/** 实例配置服务，不调用上游验证 PATCH。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class InstancesService {
  private readonly logger = new Logger(InstancesService.name);
  /** 保存实例依赖。
   * @param database 数据库。
   * @param keys 已校验的加密服务。
   * @param client 客户端，用于丢弃旧会话。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(KeysService) private readonly keys: KeysService,
    @Inject(OpenListClient) private readonly client: OpenListClient,
  ) {}
  /** 读取未归档实例。
   * @param id UUID。
   * @returns 内部记录，不直接返回 HTTP。
   * @throws ApiError 不存在；Error 数据库失败。
   */
  record(id: string): InstanceRecord {
    const row = this.database.db
      .select()
      .from(instances)
      .where(and(eq(instances.id, id), isNull(instances.archivedAt)))
      .get();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Instance not found');
    return row;
  }
  /** 获取公开视图。
   * @param id UUID。
   * @returns 无秘密对象。
   * @throws ApiError 不存在。
   */
  get(id: string): InstanceView {
    return instanceView(this.record(id));
  }
  /** 分页查询，归档记录仅在显式包含时出现。
   * @param query 已验证分页。
   * @returns 分页视图。
   * @throws ApiError offset 不安全；Error 数据库失败。
   */
  list(query: InstanceQueryDto): InstancePage {
    const offset = (query.page - 1) * query.pageSize;
    if (!Number.isSafeInteger(offset))
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Pagination offset is too large',
      );
    const predicate = query.includeArchived
      ? undefined
      : isNull(instances.archivedAt);
    const rows = this.database.db
      .select()
      .from(instances)
      .where(predicate)
      .orderBy(desc(instances.createdAt), desc(instances.id))
      .limit(query.pageSize)
      .offset(offset)
      .all();
    const total = this.database.db
      .select({ value: count() })
      .from(instances)
      .where(predicate)
      .get();
    if (!total) throw new Error('Instance count missing');
    return {
      items: rows.map(instanceView),
      page: query.page,
      pageSize: query.pageSize,
      total: total.value,
    };
  }
  /** 创建实例，凭据 AAD 绑定最终 UUID。
   * @param input 已验证请求。
   * @returns 公开视图。
   * @throws ApiError 地址或凭据非法；Error 加密或数据库失败。
   */
  create(input: InstanceCreateDto): InstanceView {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const id = randomUUID();
    const now = Date.now();
    const auth = this.credentials(id, input.auth);
    this.database.db
      .insert(instances)
      .values({
        id,
        name: input.name,
        baseUrl,
        ...auth,
        ...input.limits,
        downloadMode: input.downloadMode ?? 'd',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    this.logger.log('Instance created', { instanceId: id });
    return this.get(id);
  }
  /** 合并公开配置，auth 整体替换；不主动连接 OpenList。
   * @param id UUID。
   * @param input 已验证补丁。
   * @returns 新公开视图。
   * @throws ApiError 空补丁或非法配置；Error 数据库失败。
   */
  patch(id: string, input: InstancePatchDto): InstanceView {
    this.record(id);
    if (Object.keys(input).length === 0)
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Patch must contain at least one field',
      );
    const changes: InstanceChanges = { ...input.limits, updatedAt: Date.now() };
    if (input.name !== undefined) changes.name = input.name;
    if (input.downloadMode !== undefined)
      changes.downloadMode = input.downloadMode;
    if (input.baseUrl !== undefined)
      changes.baseUrl = normalizeBaseUrl(input.baseUrl);
    if (input.auth !== undefined)
      Object.assign(changes, this.credentials(id, input.auth));
    if (input.auth !== undefined || input.baseUrl !== undefined)
      Object.assign(changes, {
        authState: 'untested',
        authBlockReason: null,
        authBlockedUntil: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastTestAt: null,
        openlistVersion: null,
        multipartEnabled: null,
      });
    this.database.db
      .update(instances)
      .set(changes)
      .where(eq(instances.id, id))
      .run();
    if (input.auth !== undefined || input.baseUrl !== undefined)
      this.client.auth.forget(id);
    this.logger.log('Instance updated', {
      instanceId: id,
      decision: input.auth ? 'credentials_replaced' : 'configuration_updated',
    });
    return this.get(id);
  }
  /** 逻辑归档并清除当前凭据；M1 没有 Job 或未决责任表。
   * @param id UUID。
   * @returns 不适用。
   * @throws ApiError 不存在；Error 数据库失败。
   */
  archive(id: string): void {
    this.record(id);
    this.database.db
      .update(instances)
      .set({ archivedAt: Date.now(), updatedAt: Date.now(), secretEnc: null })
      .where(eq(instances.id, id))
      .run();
    this.client.auth.forget(id);
    this.logger.log('Instance archived', { instanceId: id });
  }
  /** 加密凭据并拒绝 token 头注入及掩码。
   * @param id 最终实例 UUID。
   * @param auth 完整认证输入。
   * @returns 需要写入的认证字段。
   * @throws ApiError 凭据非法；Error 加密失败。
   */
  private credentials(
    id: string,
    auth: AuthInputDto,
  ): Pick<InstanceRecord, 'authMode' | 'username' | 'secretEnc'> {
    if (
      /^\*+$/.test(auth.secret) ||
      (auth.mode === 'token' && /[^\x21-\x7e]/u.test(auth.secret))
    )
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Invalid instance credentials',
      );
    return {
      authMode: auth.mode,
      username: auth.mode === 'password' ? (auth.username ?? null) : null,
      secretEnc: this.keys.encrypt(auth.secret, {
        table: 'instances',
        recordId: id,
        field: 'secret_enc',
      }),
    };
  }
}
/** 将内部 UTC 毫秒转换为 API 时间。
 * @param value 毫秒或 null。
 * @returns RFC3339 或 null。
 * @throws RangeError 数据库时间异常。
 */
function time(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
/** 显式投影公共字段，绝不展开实体。
 * @param row 内部实例。
 * @returns 无凭据视图。
 * @throws RangeError 数据库时间非法。
 */
export function instanceView(row: InstanceRecord): InstanceView {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    auth: {
      mode: row.authMode,
      username: row.username,
      hasSecret: row.secretEnc !== null,
    },
    limits: {
      maxApiConcurrency: row.maxApiConcurrency,
      apiRequestsPerSecond: row.apiRequestsPerSecond,
      maxOutstandingTasks: row.maxOutstandingTasks,
      maxDownloadConnections: row.maxDownloadConnections,
      maxUploadSessions: row.maxUploadSessions,
      maxChunkConcurrency: row.maxChunkConcurrency,
    },
    downloadMode: row.downloadMode,
    authState: row.authState,
    authBlockReason: row.authBlockReason,
    authBlockedUntil: time(row.authBlockedUntil),
    accountUsername: row.accountUsername,
    accountBasePath: row.accountBasePath,
    accountRole: row.accountRole,
    accountPermissions: row.accountPermissions,
    lastTestAt: time(row.lastTestAt),
    openlistVersion: row.openlistVersion,
    multipartEnabled: row.multipartEnabled,
    lastError:
      row.lastErrorCode === null
        ? null
        : { code: row.lastErrorCode, message: row.lastErrorMessage ?? '' },
    archivedAt: time(row.archivedAt),
  };
}
