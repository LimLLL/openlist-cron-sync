// 解析复制任务事实与逐 ID 清理结果，不推进本地 Operation 状态。
import { Inject, Injectable } from '@nestjs/common';
import type { InstanceRecord } from '../database/schema.js';
import { OpenListAuth } from './auth.service.js';
import { integer, object, protocol, string } from './errors.js';
import { childPath, normalizePath } from './paths.js';

/** tache v0.2.2 的任务协议事实。 */
export interface TaskInfo {
  /** 上游任务 ID。 */
  id: string;
  /** 上游任务名，可能含路径，禁止日志输出。 */
  name: string;
  /** 原始状态值 0–9，不用 progress 推断终态。 */
  state: number;
  /** 状态描述，不写日志。 */
  status: string;
  /** 远端进度，只展示。 */
  progress: number;
  /** 上游是否报告错误；不保留可能包含秘密的原文。 */
  error: string;
  /** 开始时间，未开始为 null。 */
  startTime: string | null;
  /** 结束时间，未结束为 null。 */
  endTime: string | null;
  /** 总字节数。 */
  totalBytes: number;
}
/** 解析任务时间。
 * @param value JSON 时间。
 * @returns 时间或 null。
 * @throws OpenListError 格式错误。
 */
function taskTime(value: unknown): string | null {
  if (value === null) return null;
  const text = string(value);
  if (!Number.isFinite(Date.parse(text))) protocol('task time');
  return text;
}
/** 验证任务所有必要字段。
 * @param input JSON 任务。
 * @returns 类型化任务事实。
 * @throws OpenListError 字段缺失或未知状态。
 */
export function taskInfo(input: unknown): TaskInfo {
  const row = object(input);
  const state = integer(row.state);
  if (
    state > 9 ||
    typeof row.progress !== 'number' ||
    !Number.isFinite(row.progress)
  )
    protocol('task state/progress');
  const id = string(row.id);
  if (!id) protocol('task id');
  return {
    id,
    name: string(row.name),
    state,
    status: string(row.status),
    progress: row.progress,
    error: string(row.error) ? 'OpenList task reported an error' : '',
    startTime: taskTime(row.start_time),
    endTime: taskTime(row.end_time),
    totalBytes: integer(row.total_bytes),
  };
}
/** 读取可选任务列表，null/无 tasks 表示协议未返回任务。
 * @param input 成功 data。
 * @returns 任务列表。
 * @throws OpenListError 错误结构。
 */
export function returnedTasks(input: unknown): TaskInfo[] {
  if (input === null) return [];
  const data = object(input);
  if (!Object.hasOwn(data, 'tasks')) return [];
  if (!Array.isArray(data.tasks)) protocol('copy tasks');
  return data.tasks.map(taskInfo);
}
/** 同实例复制与任务管理协议客户端。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class OpenListTasks {
  /** 保存认证入口。
   * @param auth 共享认证客户端。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(@Inject(OpenListAuth) private readonly auth: OpenListAuth) {}
  /** 提交单文件复制，仅在明确的执行前 401 拒绝后重新认证并重放一次。
   * @param instance 实例。
   * @param source 源目录。
   * @param destination 目标目录。
   * @param name 原始名称。
   * @returns 上游返回的任务；空数组只表示没有 task。
   * @throws OpenListError 请求或协议失败。
   */
  async copy(
    instance: InstanceRecord,
    source: string,
    destination: string,
    name: string,
  ): Promise<TaskInfo[]> {
    childPath(source, name);
    childPath(destination, name);
    return returnedTasks(
      await this.auth.call(instance, {
        endpoint: '/api/fs/copy',
        method: 'POST',
        control: false,
        json: {
          src_dir: normalizePath(source),
          dst_dir: normalizePath(destination),
          names: [name],
          overwrite: false,
          skip_existing: false,
          merge: false,
        },
      }),
    );
  }
  /** 按 ID 读取单任务。
   * @param instance 实例。
   * @param id 任务 ID。
   * @returns 任务事实。
   * @throws OpenListError 请求或协议失败，404 保留为协议事实。
   */
  async info(instance: InstanceRecord, id: string): Promise<TaskInfo> {
    const result = taskInfo(
      await this.auth.call(instance, {
        endpoint: `/api/task/copy/info?${new URLSearchParams({ tid: id })}`,
        method: 'POST',
        read: true,
      }),
    );
    if (result.id !== id) protocol('task identity');
    return result;
  }
  /** 请求取消，不等同于任务已停止。
   * @param instance 实例。
   * @param id 任务 ID。
   * @returns 不适用。
   * @throws OpenListError 请求失败。
   */
  async cancel(instance: InstanceRecord, id: string): Promise<void> {
    await this.auth.call(instance, {
      endpoint: `/api/task/copy/cancel?${new URLSearchParams({ tid: id })}`,
      method: 'POST',
    });
  }
  /** 删除调用方已确认终态的任务记录，保留逐 ID 失败事实。
   * @param instance 实例。
   * @param ids 已终态任务 ID 集合。
   * @returns ID 到安全错误摘要的映射；空对象才表示全部成功。
   * @throws OpenListError 请求或协议失败。
   */
  async deleteSome(
    instance: InstanceRecord,
    ids: string[],
  ): Promise<Record<string, string>> {
    const data = object(
      await this.auth.call(instance, {
        endpoint: '/api/task/copy/delete_some',
        method: 'POST',
        json: ids,
      }),
    );
    const result: Record<string, string> = {};
    for (const [id, error] of Object.entries(data)) {
      if (!ids.includes(id)) protocol('task cleanup id');
      string(error);
      Object.defineProperty(result, id, {
        value: 'OpenList task cleanup rejected',
        enumerable: true,
      });
    }
    return result;
  }
}
