// 在既有v4.2.7的两个Local挂载验证L1/L2生产copy链，仅清理自有UUID目录。
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { integrationEnvironment } from './integration-environment.js';
import {
  startApplication,
  environmentFor,
  temporaryDirectory,
} from './helpers.js';
import type { TestDirectory } from './helpers.js';
import { InstancesService } from '../src/instances/instances.service.js';
import { InstanceOperations } from '../src/instances/instance-operations.service.js';
import { JobsService } from '../src/jobs/jobs.service.js';
import { RunsService } from '../src/runs/runs.service.js';
import { OpenListClient } from '../src/openlist/client.service.js';
import { OpenListMultipart } from '../src/openlist/multipart.service.js';
import { OpenListTasks } from '../src/openlist/tasks.service.js';
import { OpenListError } from '../src/openlist/errors.js';
import { downloadUrl } from '../src/openlist/paths.js';

const environment = integrationEnvironment();
/** 注册真实Local复制验收。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M6 real Local server_copy topologies', () => {
  let app: NestExpressApplication;
  let temporary: TestDirectory;
  let id: string;
  const roots: string[] = [];
  /** 使用现有容器及凭据，连接测试不修改远端配置。
   * @param 不适用。
   * @returns 应用就绪。
   * @throws Error 连接或版本失败。
   */
  beforeAll(async () => {
    temporary = await temporaryDirectory();
    app = await startApplication(
      environmentFor(temporary.path, {
        SPOOL_RESERVE_BYTES: '0',
        OPENLIST_TASK_POLL_MS: '500',
      }),
    );
    id = app
      .get(InstancesService)
      .create({
        name: 'M6 Local',
        baseUrl: environment.baseUrl,
        auth: { mode: 'token', secret: environment.adminToken },
      }).id;
    expect(
      (await app.get(InstanceOperations).test(id, { retryAuth: false })).error,
    ).toBeNull();
    expect(app.get(InstancesService).get(id).openlistVersion).toMatch(
      /4\.2\.7/,
    );
  });
  /** 清理自有目录及本地应用，不调整容器。
   * @param 不适用。
   * @returns 清理完成。
   * @throws Error 清理失败。
   */
  afterAll(async () => {
    try {
      if (app) for (const path of roots.reverse()) await clean(path, path);
    } finally {
      if (app) await app.close();
      if (temporary) await temporary.remove();
    }
  });
  /** 读取当前内部连接记录，禁止输出凭据。
   * @param 不适用。
   * @returns 实例。
   * @throws Error 实例不存在。
   */
  function record() {
    return app.get(InstancesService).record(id);
  }
  /** 准备自有测试根。
   * @param mount 已有Local挂载。
   * @returns 新根路径。
   * @throws OpenListError mkdir失败。
   */
  async function root(mount: string): Promise<string> {
    const path = mount.replace(/\/$/, '') + '/codex-m456-' + randomUUID();
    await app.get(OpenListClient).mkdir(record(), path);
    roots.push(path);
    return path;
  }
  /** 独立协议上传夹具，不经过被测copy策略。
   * @param path 测试目录。
   * @param name 原始名称。
   * @param bytes 夹具内容。
   * @returns 上传完成。
   * @throws Error 上传失败。
   */
  async function seed(
    path: string,
    name: string,
    bytes: Buffer,
  ): Promise<void> {
    const uploads = app.get(OpenListMultipart);
    const instance = record();
    const session = await uploads.init(
      instance,
      { directory: path, name },
      bytes.length,
    );
    const signal = AbortSignal.timeout(30000);
    for (
      let offset = 0, index = 0;
      offset < bytes.length;
      offset += session.chunkSize, index++
    )
      await uploads.chunk(
        instance,
        session.uploadId,
        index,
        bytes.subarray(offset, offset + session.chunkSize),
        signal,
      );
    await uploads.complete(instance, session.uploadId, signal);
  }
  /** 单拓扑同时验证替换、真实task分支及生产清理。
   * @param label 拓扑标识。
   * @param destinationMount 已有目标挂载。
   * @returns 验证完成。
   * @throws Error 断言、网络或Run失败。
   */
  async function topology(
    label: 'L1' | 'L2',
    destinationMount: string,
  ): Promise<void> {
    const source = await root(environment.localPath),
      target = await root(destinationMount);
    const bytes = Buffer.alloc(1048576 + 4097);
    for (let index = 0; index < bytes.length; index++)
      bytes[index] = index % 251;
    await seed(source, 'copy.txt', bytes);
    await seed(target, 'copy.txt', Buffer.from('old'));
    const job = app
      .get(JobsService)
      .create({
        name: 'M6 ' + label,
        createMode: 'server_copy',
        source: { instanceId: id, path: source, refresh: true },
        targets: [{ instanceId: id, path: target, refresh: true }],
      });
    const service = app.get(RunsService);
    const accepted = service.trigger(job.id, {
      dryRun: false,
      confirmDeletes: true,
    });
    const until = Date.now() + 120000;
    while (
      !['succeeded', 'failed', 'partial', 'cancelled', 'interrupted'].includes(
        service.get(accepted.id).status,
      )
    ) {
      if (Date.now() >= until)
        throw new Error('Copy integration deadline exceeded');
      await delay(100);
    }
    const run = service.get(accepted.id);
    expect(run.status).toBe('succeeded');
    const ops = service.operations(run.id, {
      page: 1,
      pageSize: 200,
      includeMaintenance: false,
    }).items;
    const copy = ops.find(isCreate);
    if (!copy) throw new Error('Copy operation missing');
    expect(ops.map(operationStatus)).toEqual(['succeeded', 'succeeded']);
    if (label === 'L2') expect(copy.task).not.toBeNull();
    if (copy.task) {
      expect(copy.task.state).toBe(2);
      await expect(
        app.get(OpenListTasks).info(record(), copy.task.id),
      ).rejects.toMatchObject({ upstreamCode: 404 });
    } else expect(copy.status).toBe('succeeded');
    const client = app.get(OpenListClient);
    const list = await client.list(record(), target, '', true);
    const file = list.items.find(isCopyName);
    if (!file) throw new Error('Copied file absent');
    const url = downloadUrl(
      record().baseUrl,
      record().accountBasePath ?? '/',
      target,
      'copy.txt',
      file.sign,
      'd',
    );
    const response = await fetch(url);
    expect(response.ok).toBe(true);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    console.log(
      JSON.stringify({
        topology: label,
        version: '4.2.7',
        driver: 'Local',
        copy: copy.task ? 'task' : 'synchronous',
        remoteState: copy.task?.state ?? null,
        cleanup: copy.task ? 'info404' : 'no-task',
        bytes: bytes.length,
      }),
    );
  }
  /** L1不预设Local驱动是否可同步Copy。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('L1 records and asserts the actual same-storage response branch', async () => {
    await topology('L1', environment.localPath);
  });
  /** L2必须通过生产tracker收敛远程task。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('L2 tracks cross-storage copy to terminal and removes its task record', async () => {
    await topology('L2', environment.secondLocalPath);
  });
  /** 清理范围严格限制在测试自有根。
   * @param allowed 本测试根。
   * @param path 当前路径。
   * @returns 清理完成。
   * @throws Error 越界或远程失败。
   */
  async function clean(allowed: string, path: string): Promise<void> {
    if (path !== allowed && !path.startsWith(allowed + '/'))
      throw new Error('Cleanup escaped test root');
    const client = app.get(OpenListClient);
    try {
      for (const entry of (await client.list(record(), path, '', true)).items) {
        if (entry.isDir) await clean(allowed, path + '/' + entry.name);
        else await client.remove(record(), path, entry.name);
      }
      const index = path.lastIndexOf('/');
      await client.remove(
        record(),
        path.slice(0, index) || '/',
        path.slice(index + 1),
      );
    } catch (error) {
      if (error instanceof OpenListError)
        console.error('Owned integration cleanup failed', { code: error.code });
      throw error;
    }
  }
});
/** 选择create。
 * @param op 操作。
 * @returns 是否create。
 * @throws 不适用。
 */
function isCreate(op: { action: string }): boolean {
  return op.action === 'create';
}
/** 提取状态。
 * @param op 操作。
 * @returns 状态。
 * @throws 不适用。
 */
function operationStatus(op: { status: string }): string {
  return op.status;
}
/** 选择测试文件。
 * @param entry 条目。
 * @returns 是否测试文件。
 * @throws 不适用。
 */
function isCopyName(entry: { name: string }): boolean {
  return entry.name === 'copy.txt';
}
