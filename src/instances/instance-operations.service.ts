// 编排只读连接测试与浏览，将上游失败转换为公共契约。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InstancesService } from './instances.service.js';
import { InstanceAuthState } from '../security/instance-auth-state.service.js';
import { OpenListClient } from '../openlist/client.service.js';
import { OpenListError } from '../openlist/errors.js';
import { ApiError } from '../common/errors.js';
import { accountWarnings } from '../openlist/protocol.js';
import { globalPath, normalizePath } from '../openlist/paths.js';
import { resolveMount } from '../openlist/mounts.js';
import type { BrowseRequestDto, TestRequestDto } from './input.dto.js';
import type { BrowseResultDto, TestResultDto } from './operations.dto.js';

/** 实例只读操作编排，不探测上传或删除权限。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class InstanceOperations {
  private readonly logger = new Logger(InstanceOperations.name);
  /** 保存实例与协议服务。
   * @param instances 实例配置。
   * @param client 上游客户端。
   * @param states 持久状态。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(InstancesService) private readonly instances: InstancesService,
    @Inject(OpenListClient) private readonly client: OpenListClient,
    @Inject(InstanceAuthState) private readonly states: InstanceAuthState,
  ) {}
  /** 完成只读连接测试，预期上游失败仍返回 TestResult。
   * @param id 实例 UUID。
   * @param input 人工恢复选项。
   * @returns 可达性、身份、能力警告和错误。
   * @throws ApiError 本地资源或冷却错误；Error 数据库等不可恢复错误。
   */
  async test(id: string, input: TestRequestDto): Promise<TestResultDto> {
    const instance = this.instances.record(id);
    if (input.retryAuth) this.client.auth.retryManually(instance);
    this.logger.log('Testing OpenList connection', {
      instanceId: id,
      retryAuth: input.retryAuth,
    });
    const result: TestResultDto = {
      reachable: false,
      authenticated: false,
      account: null,
      warnings: [],
      error: null,
    };
    try {
      result.account = await this.client.auth.account(
        instance,
        true,
        input.retryAuth,
      );
      result.reachable = true;
      result.authenticated = true;
      result.warnings = accountWarnings(result.account);
      const settings = await this.client.settings(instance);
      this.states.save(instance, {
        openlistVersion: settings.version,
        multipartEnabled: settings.multipart?.enabled ?? null,
      });
      if (!settings.multipart)
        throw new OpenListError(
          'OPENLIST_VERSION_UNSUPPORTED',
          'OpenList version must be at least 4.2.5',
        );
      if (!settings.multipart.enabled)
        result.warnings.push({
          code: 'MULTIPART_DISABLED',
          message: 'OpenList multipart uploads are disabled',
        });
      if (result.account.role === 2) await this.client.storages(instance);
    } catch (error) {
      if (!(error instanceof OpenListError)) throw error;
      result.reachable ||=
        error.httpStatus !== null || error.code === 'UPSTREAM_PROTOCOL_ERROR';
      result.error = { code: error.code, message: error.message };
      this.logger.warn('OpenList connection test failed', {
        instanceId: id,
        errorCode: error.code,
      });
    }
    const problem =
      result.error ?? result.warnings.find(isMultipartDisabled) ?? null;
    this.states.save(instance, {
      lastTestAt: Date.now(),
      lastErrorCode: problem?.code ?? null,
      lastErrorMessage: problem?.message ?? null,
    });
    return result;
  }
  /** 本地分页浏览，只投影可用名称，管理员挂载失败不降级。
   * @param id 实例 UUID。
   * @param input 目录、路径密码和分页。
   * @returns 无 sign/raw_url 的公开列表。
   * @throws ApiError 路径错误或上游 502；Error 数据库失败。
   */
  async browse(id: string, input: BrowseRequestDto): Promise<BrowseResultDto> {
    const path = normalizePath(input.path);
    const offset = (input.page - 1) * input.pageSize;
    if (!Number.isSafeInteger(offset))
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Pagination offset is too large',
      );
    const instance = this.instances.record(id);
    this.logger.log('Browsing OpenList directory', {
      instanceId: id,
      refresh: input.refresh,
      page: input.page,
    });
    try {
      const account = await this.client.auth.account(instance);
      const warnings = accountWarnings(account);
      if (account.role === 2) {
        const mounts = await this.client.storages(instance);
        const resolved = resolveMount(
          mounts,
          globalPath(account.basePath, path),
        );
        if (resolved.suspect)
          warnings.push({
            code: 'SUSPECT_VIEW',
            message: 'Directory contains a nested mount boundary',
          });
        if (!resolved.storage)
          warnings.push({
            code: 'MOUNT_BOUNDARY_UNKNOWN',
            message: 'No unique writable storage can be established',
          });
      }
      const list = await this.client.list(
        instance,
        path,
        input.password ?? '',
        input.refresh,
      );
      if (account.role !== 2 && list.items.some(hasMountDetails))
        warnings.push({
          code: 'SUSPECT_VIEW',
          message: 'Directory contains a mount hint',
        });
      return {
        path,
        items: list.items
          .slice(offset, offset + input.pageSize)
          .map(browseItem),
        total: list.items.length,
        page: input.page,
        pageSize: input.pageSize,
        write: list.write,
        warnings: [...warnings, ...list.warnings].map(
          /** 将内部警告投影为公开警告，丢弃内部诊断事实。
           * @param warning 账号、挂载或列表警告。
           * @returns 仅含 code 与 message 的警告。
           * @throws 不适用。
           */
          ({ code, message }) => ({ code, message }),
        ),
      };
    } catch (error) {
      if (!(error instanceof OpenListError)) throw error;
      this.logger.warn('OpenList browse failed', {
        instanceId: id,
        errorCode: error.code,
      });
      throw new ApiError(
        502,
        error.code === 'UPSTREAM_JSON_TOO_LARGE' ||
          error.code === 'UPSTREAM_PROTOCOL_ERROR' ||
          error.code === 'INVALID_SIZE'
          ? 'UPSTREAM_PROTOCOL_ERROR'
          : 'OPENLIST_ERROR',
        error.message,
      );
    }
  }
}
/** 识别分片能力警告。
 * @param warning 警告。
 * @returns 是否影响 relay 目标能力。
 * @throws 不适用。
 */
function isMultipartDisabled(warning: { code: string }): boolean {
  return warning.code === 'MULTIPART_DISABLED';
}
/** 判断条目挂载提示。
 * @param item 内部条目。
 * @returns 是否有挂载提示。
 * @throws 不适用。
 */
function hasMountDetails(item: { mountDetails: boolean }): boolean {
  return item.mountDetails;
}
/** 投影安全浏览条目。
 * @param item 内部文件。
 * @returns 无下载秘密的条目。
 * @throws 不适用。
 */
function browseItem(item: {
  name: string;
  size: number | null;
  isDir: boolean;
  modified: string | null;
}): {
  name: string;
  size: number | null;
  isDir: boolean;
  modified: string | null;
} {
  return {
    name: item.name,
    size: item.size,
    isDir: item.isDir,
    modified: item.modified,
  };
}
