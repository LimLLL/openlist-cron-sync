// 实现分片五端点与零字节 put 的协议，不实现 relay 重传或结果分类。
import { Inject, Injectable } from '@nestjs/common';
import type { InstanceRecord } from '../database/schema.js';
import { OpenListAuth } from './auth.service.js';
import { integer, object, protocol, string } from './errors.js';
import { childPath } from './paths.js';
import type { Readable } from 'node:stream';
import type { RequestContext } from './request-context.js';
import { taskInfo } from './tasks.service.js';
import type { TaskInfo } from './tasks.service.js';

/** 分片会话的上游状态。 */
export type MultipartState =
  | 'receiving'
  | 'completed'
  | 'failed_retriable'
  | 'failed_permanent'
  | 'aborted';
/** 分片会话协议快照，只用于当前调用，不持久化。 */
export interface MultipartSnapshot {
  /** 上游 upload_id。 */
  uploadId: string;
  /** 上游状态。 */
  state: MultipartState;
  /** 上游尝试序号。 */
  attempt: number;
  /** 上游实际分片大小，字节。 */
  chunkSize: number;
  /** 分片总数。 */
  totalChunks: number;
  /** 已接收的闭区间。 */
  received: [number, number][];
  /** 已接收字节数。 */
  receivedBytes: number;
  /** 下一消费分片位置。 */
  frontier: number;
}
/** 校验完整快照，不从缺失字段猜测会话状态。
 * @param input 成功 data。
 * @returns 类型化快照。
 * @throws OpenListError 无效协议。
 */
export function multipartSnapshot(input: unknown): MultipartSnapshot {
  const data = object(input);
  const state = string(data.state);
  if (
    state !== 'receiving' &&
    state !== 'completed' &&
    state !== 'failed_retriable' &&
    state !== 'failed_permanent' &&
    state !== 'aborted'
  )
    protocol('multipart state');
  const uploadId = string(data.upload_id);
  const totalChunks = integer(data.total_chunks);
  const chunkSize = integer(data.chunk_size);
  const frontier = integer(data.frontier);
  // 上游以 Go nil 切片表示尚未收到任何分片，序列化为 null；init 响应必然如此。
  const ranges: unknown = data.received === null ? [] : data.received;
  if (
    !uploadId ||
    !totalChunks ||
    !chunkSize ||
    frontier > totalChunks ||
    !Array.isArray(ranges)
  )
    protocol('multipart snapshot');
  const received: [number, number][] = [];
  let end = -1;
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length !== 2)
      protocol('multipart received');
    const first = integer(range[0]);
    const last = integer(range[1]);
    if (first > last || first <= end || last >= totalChunks)
      protocol('multipart received range');
    received.push([first, last]);
    end = last;
  }
  return {
    uploadId,
    state,
    attempt: integer(data.attempt),
    chunkSize,
    totalChunks,
    received,
    receivedBytes: integer(data.received_bytes),
    frontier,
  };
}
/** 上传目的对象。 */
export interface UploadFile {
  /** 账号内父目录。 */
  directory: string;
  /** 原始文件名。 */
  name: string;
  /** 修改时间；非法或非正时间不发送。 */
  modified?: string | null;
}
/** 构造编码一次的上传头。
 * @param file 已知文件。
 * @returns 不含 Content-Type 的上传头。
 * @throws OpenListError 非法名称；ApiError 非法目录。
 */
export function uploadHeaders(file: UploadFile): Record<string, string> {
  const headers: Record<string, string> = {
    'File-Path': encodeURIComponent(childPath(file.directory, file.name)),
    Overwrite: 'false',
  };
  const modified = file.modified ? Date.parse(file.modified) : NaN;
  if (Number.isSafeInteger(modified) && modified > 0)
    headers['Last-Modified'] = String(modified);
  return headers;
}
/** 分片和空文件上传协议客户端。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class OpenListMultipart {
  /** 保存共享认证入口。
   * @param auth 认证客户端。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(@Inject(OpenListAuth) private readonly auth: OpenListAuth) {}
  /** 创建非空上传；此调用会启动驱动写入。
   * @param instance 实例。
   * @param file 目标文件。
   * @param size 精确正整数字节数。
   * @param context 调用方固定设置、停止信号及提交前持久化检查点。
   * @returns 上游会话事实。
   * @throws RangeError 大小非法；OpenListError 请求或协议失败。
   */
  async init(
    instance: InstanceRecord,
    file: UploadFile,
    size: number,
    context: RequestContext = {},
  ): Promise<MultipartSnapshot> {
    if (!Number.isSafeInteger(size) || size <= 0)
      throw new RangeError('Multipart upload size must be a positive integer');
    return multipartSnapshot(
      await this.auth.call(instance, {
        ...context,
        endpoint: '/api/fs/multipart/init',
        method: 'POST',
        // init 一经执行即启动驱动写入，属于新提交，不占用控制请求的优先位置。
        control: false,
        headers: { ...uploadHeaders(file), 'X-File-Size': String(size) },
      }),
    );
  }
  /** 发送单分片；重传由后续 relay 按会话事实决定。
   * @param instance 实例。
   * @param uploadId 会话 ID。
   * @param index 零起始序号。
   * @param body 精确字节。
   * @param signal relay 提供的期限信号。
   * @param context 调用方固定设置、停止信号及提交前持久化检查点。
   * @param size 流式body的精确Content-Length，流式body必填；Buffer默认采用自身长度。
   * @returns 上游会话事实。
   * @throws RangeError 分片序号或长度非法；OpenListError 请求或协议失败。
   */
  async chunk(
    instance: InstanceRecord,
    uploadId: string,
    index: number,
    body: Buffer | Readable,
    signal: AbortSignal,
    context: RequestContext = {},
    size?: number,
  ): Promise<MultipartSnapshot> {
    if (!Number.isSafeInteger(index) || index < 0)
      throw new RangeError(
        'Multipart chunk index must be a non-negative integer',
      );
    const length = Buffer.isBuffer(body) ? (size ?? body.length) : size;
    if (length === undefined || !Number.isSafeInteger(length) || length <= 0)
      throw new RangeError('Multipart chunk length must be a positive integer');
    return this.checked(
      uploadId,
      await this.auth.call(instance, {
        ...context,
        endpoint: '/api/fs/multipart/chunk',
        method: 'PUT',
        transfer: true,
        signal,
        body,
        headers: {
          'X-Upload-Id': uploadId,
          'X-Chunk-Index': String(index),
          'Content-Length': String(length),
        },
      }),
    );
  }
  /** 等待驱动完成；不使用控制 API 的短超时。
   * @param instance 实例。
   * @param uploadId 会话 ID。
   * @param signal relay 的期限信号。
   * @param context 调用方固定设置、停止信号及提交前持久化检查点。
   * @returns 已验证session快照，由Relay按state决定是否完成。
   * @throws OpenListError 请求失败或session结构非法。
   */
  async complete(
    instance: InstanceRecord,
    uploadId: string,
    signal: AbortSignal,
    context: RequestContext = {},
  ): Promise<MultipartSnapshot> {
    const result = this.checked(
      uploadId,
      await this.auth.call(instance, {
        ...context,
        endpoint: '/api/fs/multipart/complete',
        method: 'POST',
        transfer: true,
        signal,
        headers: { 'X-Upload-Id': uploadId },
      }),
    );
    return result;
  }
  /** 按 ID 查询会话，不按 path+size 接管。
   * @param instance 实例。
   * @param uploadId 会话 ID。
   * @param context 调用方固定设置、停止信号及提交前持久化检查点。
   * @returns 快照。
   * @throws OpenListError 请求或结构错误。
   */
  async status(
    instance: InstanceRecord,
    uploadId: string,
    context: RequestContext = {},
  ): Promise<MultipartSnapshot> {
    return this.checked(
      uploadId,
      await this.auth.call(instance, {
        ...context,
        endpoint: `/api/fs/multipart/status?${new URLSearchParams({ upload_id: uploadId })}`,
        method: 'GET',
        read: true,
      }),
    );
  }
  /** 请求中止，不表示底层驱动已停止。
   * @param instance 实例。
   * @param uploadId 会话 ID。
   * @param context 调用方固定设置、停止信号及提交前持久化检查点。
   * @returns 不适用。
   * @throws OpenListError 请求失败。
   */
  async abort(
    instance: InstanceRecord,
    uploadId: string,
    context: RequestContext = {},
  ): Promise<void> {
    await this.auth.call(instance, {
      ...context,
      endpoint: '/api/fs/multipart/abort',
      method: 'POST',
      headers: { 'X-Upload-Id': uploadId },
    });
  }
  /** 上传已证明为空的文件，保留任何意外任务供调用方处理。
   * @param instance 实例。
   * @param file 目标文件。
   * @param context 调用方固定设置、停止信号及提交前持久化检查点。
   * @returns 上游任务事实；正常为空，非空由执行器记unknown协议异常，不持久化tid。
   * @throws OpenListError 请求失败。
   */
  async putEmpty(
    instance: InstanceRecord,
    file: UploadFile,
    context: RequestContext = {},
  ): Promise<TaskInfo[]> {
    const data = await this.auth.call(instance, {
      ...context,
      endpoint: '/api/fs/put',
      method: 'PUT',
      control: false,
      body: Buffer.alloc(0),
      headers: {
        ...uploadHeaders(file),
        'Content-Length': '0',
        'As-Task': 'false',
      },
    });
    if (data === null) return [];
    const result = object(data);
    if (Object.hasOwn(result, 'task')) return [taskInfo(result.task)];
    protocol('empty put task response');
  }
  /** 验证快照仍属于所请求会话。
   * @param id 预期 ID。
   * @param data 上游 data。
   * @returns 快照。
   * @throws OpenListError ID 不一致。
   */
  private checked(id: string, data: unknown): MultipartSnapshot {
    const result = multipartSnapshot(data);
    if (result.uploadId !== id) protocol('multipart identity');
    return result;
  }
}
