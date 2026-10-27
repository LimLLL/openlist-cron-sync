// 提供 OpenList 文件、设置和完整挂载读取，不实现变更结果推断。
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { InstanceRecord } from '../database/schema.js';
import { OpenListAuth } from './auth.service.js';
import { OpenListTransport } from './transport.service.js';
import { fileEntry, fileList, publicSettings } from './protocol.js';
import type { FileEntry, FileList, PublicSettings } from './protocol.js';
import { normalizePath, childPath } from './paths.js';
import { OpenListError } from './errors.js';
import { storagePage } from './mounts.js';
import type { RequestContext } from './request-context.js';
import type { Storage } from './mounts.js';

/** 文件和能力协议客户端。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class OpenListClient {
  private readonly logger = new Logger(OpenListClient.name);
  /** 保存共享传输与认证。
   * @param auth 认证状态机。
   * @param transport 公开请求传输。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(OpenListAuth) readonly auth: OpenListAuth,
    @Inject(OpenListTransport) private readonly transport: OpenListTransport,
  ) {}
  /** 读取公开设置；同样遵守实例持久认证阻断。
   * @param instance 实例配置。
   * @returns 类型化设置。
   * @throws OpenListError 请求或结构错误。
   */
  async settings(instance: InstanceRecord): Promise<PublicSettings> {
    this.auth.assertAllowed(instance);
    return publicSettings(
      await this.transport.call(instance, {
        endpoint: '/api/public/settings',
        method: 'GET',
        read: true,
      }),
    );
  }
  /** 读取完整目录，不使用上游分页造成部分视图。
   * @param instance 实例。
   * @param path 账号路径。
   * @param password 路径密码。
   * @param refresh 是否强制刷新。
   * @param context 调用方的中止信号与 Run 固定参数（含单目录条目上限）；省略时使用进程配置。
   * @returns 列表与非法名称警告。
   * @throws OpenListError 上游失败；ApiError 路径非法。
   */
  async list(
    instance: InstanceRecord,
    path: string,
    password = '',
    refresh = false,
    context: RequestContext = {},
  ): Promise<FileList> {
    const normalized = normalizePath(path);
    return fileList(
      await this.auth.call(instance, {
        ...context,
        endpoint: '/api/fs/list',
        method: 'POST',
        read: true,
        json: { path: normalized, password, refresh, page: 1, per_page: 0 },
      }),
      normalized,
      context.settings?.scanMaxDirectoryEntries,
    );
  }
  /** 读取单文件诊断；不把缓存结果当新鲜度证明。
   * @param instance 实例。
   * @param directory 账号目录。
   * @param name 原始名称。
   * @param password 路径密码。
   * @param context 调用方固定设置、停止信号及提交前持久化检查点。
   * @returns 合法条目；raw_url 不透出。
   * @throws OpenListError 请求失败；ApiError 路径非法。
   */
  async get(
    instance: InstanceRecord,
    directory: string,
    name: string,
    password = '',
    context: RequestContext = {},
  ): Promise<FileEntry> {
    const path = childPath(directory, name);
    return fileEntry(
      await this.auth.call(instance, {
        ...context,
        endpoint: '/api/fs/get',
        method: 'POST',
        read: true,
        json: { path, password },
      }),
    );
  }
  /** 创建目录，只返回协议成功事实。
   * @param instance 实例。
   * @param path 账号目录。
   * @param context 调用方固定设置、停止信号及提交前持久化检查点。
   * @returns 不适用。
   * @throws OpenListError 上游失败；ApiError 路径非法。
   */
  async mkdir(
    instance: InstanceRecord,
    path: string,
    context: RequestContext = {},
  ): Promise<void> {
    await this.auth.call(instance, {
      ...context,
      endpoint: '/api/fs/mkdir',
      method: 'POST',
      json: { path: normalizePath(path) },
    });
  }
  /** 删除单名称对象，不观察或推断最终结果。
   * @param instance 实例。
   * @param directory 账号目录。
   * @param name 原始名称。
   * @param context 调用方固定设置、停止信号及提交前持久化检查点。
   * @returns 不适用。
   * @throws OpenListError 非法名称或上游失败。
   */
  async remove(
    instance: InstanceRecord,
    directory: string,
    name: string,
    context: RequestContext = {},
  ): Promise<void> {
    childPath(directory, name);
    await this.auth.call(instance, {
      ...context,
      endpoint: '/api/fs/remove',
      method: 'POST',
      json: { dir: normalizePath(directory), names: [name] },
    });
  }
  /** 完整读取管理员存储表；不一致只重读一次，绝不降级。
   * @param instance 实例。
   * @param context 调用方的中止信号与 Run 固定参数；省略时使用进程配置。
   * @returns 完整且字段筛选后的存储集合。
   * @throws OpenListError 不可读或分页不一致。
   */
  async storages(
    instance: InstanceRecord,
    context: RequestContext = {},
  ): Promise<Storage[]> {
    const account = await this.auth.account(instance, false, false, context);
    if (account.role !== 2)
      throw new OpenListError(
        'MOUNT_BOUNDARY_UNKNOWN',
        'Admin account required for mount map',
      );
    for (let pass = 0; pass < 2; pass++) {
      try {
        const rows: Storage[] = [];
        const ids = new Set<number>();
        let total: number | undefined;
        for (let page = 1; ; page++) {
          const result = storagePage(
            await this.auth.call(instance, {
              endpoint: `/api/admin/storage/list?page=${page}&per_page=100`,
              method: 'GET',
              read: true,
              signal: context.signal,
              cleanup: context.cleanup,
              settings: context.settings,
            }),
          );
          if (total !== undefined && result.total !== total) break;
          total = result.total;
          if (
            result.content.length > 100 ||
            (result.content.length === 0 && rows.length < total)
          )
            break;
          let duplicate = false;
          for (const row of result.content) {
            if (ids.has(row.id)) duplicate = true;
            ids.add(row.id);
            rows.push(row);
          }
          if (duplicate || rows.length > total) break;
          if (rows.length === total) return rows;
        }
      } catch (error) {
        context.signal?.throwIfAborted();
        if (!(error instanceof OpenListError)) throw error;
        if (error.code === 'UPSTREAM_JSON_TOO_LARGE') throw error;
        if (error.code !== 'UPSTREAM_PROTOCOL_ERROR') {
          this.logger.warn('OpenList mount map unavailable', {
            instanceId: instance.id,
            errorCode: error.code,
          });
          throw new OpenListError(
            'MOUNT_BOUNDARY_UNKNOWN',
            'OpenList admin mount map could not be read',
          );
        }
      }
    }
    this.logger.warn('OpenList mount pagination inconsistent', {
      instanceId: instance.id,
      errorCode: 'MOUNT_BOUNDARY_UNKNOWN',
    });
    throw new OpenListError(
      'MOUNT_BOUNDARY_UNKNOWN',
      'OpenList admin mount pagination is inconsistent',
    );
  }
}
