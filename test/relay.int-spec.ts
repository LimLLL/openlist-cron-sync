// 在维护者提供的两个实例上执行L1/L2-relay/L3；只写入本测试UUID目录。
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
import { OpenListClient } from '../src/openlist/client.service.js';
import { OpenListMultipart } from '../src/openlist/multipart.service.js';
import { JobsService } from '../src/jobs/jobs.service.js';
import { RunsService } from '../src/runs/runs.service.js';
import { downloadUrl } from '../src/openlist/paths.js';
import { OpenListError } from '../src/openlist/errors.js';
import type { InstanceRecord } from '../src/database/schema.js';
import { resolveMount } from '../src/openlist/mounts.js';
import { globalPath } from '../src/openlist/paths.js';
import { OperationsService } from '../src/runs/operations.service.js';

const environment = integrationEnvironment();
/** 一个已经核实的Local测试端点。 */
interface Endpoint {
  /** 本服务实例ID。 */
  id: string;
  /** 该实例的Local挂载路径。 */
  path: string;
}
/** 注册真实网络验收；不创建或调整容器。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
describe('M3 real Local relay topologies', () => {
  let app: NestExpressApplication;
  let temporary: TestDirectory;
  let primary: string;
  let peer: string;
  let client: OpenListClient;
  let uploads: OpenListMultipart;
  const roots: Endpoint[] = [];
  /** 验证已提供的实例版本和挂载，不读取或输出token。
   * @param 不适用。
   * @returns 应用和实例就绪。
   * @throws Error 环境、网络或版本不满足要求。
   */
  beforeAll(async () => {
    temporary = await temporaryDirectory();
    app = await startApplication(
      environmentFor(temporary.path, { SPOOL_RESERVE_BYTES: '0' }),
    );
    const instances = app.get(InstancesService);
    primary = instances.create({
      name: 'M3 primary',
      baseUrl: environment.baseUrl,
      auth: { mode: 'token', secret: environment.adminToken },
    }).id;
    peer = instances.create({
      name: 'M3 peer',
      baseUrl: environment.peerBaseUrl,
      auth: { mode: 'token', secret: environment.peerAdminToken },
    }).id;
    client = app.get(OpenListClient);
    uploads = app.get(OpenListMultipart);
    for (const id of [primary, peer]) {
      const result = await app
        .get(InstanceOperations)
        .test(id, { retryAuth: false });
      expect(result.error).toBeNull();
      expect(result.authenticated).toBe(true);
    }
    expect(instances.get(primary).openlistVersion).toMatch(/4\.2\.7/);
    expect(instances.get(peer).openlistVersion).toMatch(/4\.2\.5/);
    for (const endpoint of [
      { id: primary, path: environment.localPath },
      { id: primary, path: environment.secondLocalPath },
      { id: peer, path: environment.peerLocalPath },
    ]) {
      const instance = instances.record(endpoint.id);
      const mount = resolveMount(
        await client.storages(instance),
        globalPath(instance.accountBasePath ?? '/', endpoint.path),
      );
      expect(mount.storage?.driver).toBe('Local');
    }
  });
  /** 只清理本测试成功登记的UUID目录，随后关闭应用。
   * @param 不适用。
   * @returns 本测试资源退出。
   * @throws Error 清理或关闭失败。
   */
  afterAll(async () => {
    try {
      if (app) for (const root of roots.reverse()) await clean(root, root.path);
    } finally {
      if (app) await app.close();
      if (temporary) await temporary.remove();
    }
  });
  /** 取得当前凭据，绝不把它序列化到测试输出。
   * @param id 实例ID。
   * @returns 内部实例记录。
   * @throws Error 实例不存在。
   */
  function record(id: string): InstanceRecord {
    return app.get(InstancesService).record(id);
  }
  /** 递归枚举测试目录，逐个删除文件和已空目录。
   * @param root 清理允许范围。
   * @param path 当前待清理路径。
   * @returns 清理完成。
   * @throws Error 路径越界或请求失败。
   */
  async function clean(root: Endpoint, path: string): Promise<void> {
    if (path !== root.path && !path.startsWith(root.path + '/'))
      throw new Error('Integration cleanup escaped test root');
    for (const entry of (await client.list(record(root.id), path, '', true))
      .items) {
      if (entry.isDir) await clean(root, path + '/' + entry.name);
      else await client.remove(record(root.id), path, entry.name);
    }
    const index = path.lastIndexOf('/');
    await client.remove(
      record(root.id),
      path.slice(0, index) || '/',
      path.slice(index + 1),
    );
  }
  /** 创建本用例自有根，立即登记清理责任。
   * @param endpoint 已提供的Local挂载。
   * @returns 本测试独有根。
   * @throws Error mkdir失败。
   */
  async function owned(endpoint: Endpoint): Promise<Endpoint> {
    const root = {
      id: endpoint.id,
      path: endpoint.path.replace(/\/$/, '') + '/codex-m3-' + randomUUID(),
    };
    await client.mkdir(record(root.id), root.path);
    roots.push(root);
    return root;
  }
  /** 用协议客户端准备源/旧目标；与被测执行器独立。
   * @param endpoint 目标测试目录。
   * @param name 文件原名。
   * @param data 测试内容。
   * @returns 写入完成。
   * @throws Error 上游上传失败。
   */
  async function seed(
    endpoint: Endpoint,
    name: string,
    data: Buffer,
  ): Promise<void> {
    const instance = record(endpoint.id);
    const file = { directory: endpoint.path, name };
    if (!data.length) {
      await uploads.putEmpty(instance, file, {
        signal: AbortSignal.timeout(30000),
      });
      return;
    }
    const session = await uploads.init(instance, file, data.length);
    const signal = AbortSignal.timeout(30000);
    for (
      let offset = 0, index = 0;
      offset < data.length;
      offset += session.chunkSize, index++
    )
      await uploads.chunk(
        instance,
        session.uploadId,
        index,
        data.subarray(offset, offset + session.chunkSize),
        signal,
      );
    await uploads.complete(instance, session.uploadId, signal);
  }
  /** 同时验收新建、替换、空文件和mirror目录清理。
   * @param sourceMount 源Local存储。
   * @param targetMount 目标Local存储。
   * @returns 验收完成。
   * @throws Error 执行超时或断言失败。
   */
  async function topology(
    sourceMount: Endpoint,
    targetMount: Endpoint,
  ): Promise<void> {
    const source = await owned(sourceMount);
    const target = await owned(targetMount);
    const data = Buffer.from('M3 relay 内容 + % # ? 😀\n'.repeat(100));
    // 超过OpenList默认10 MiB分片，按真实chunk_size覆盖多chunk拼装；内容按位置变化以发现乱序。
    const large = Buffer.alloc(10 * 1048576 + 4097);
    for (let index = 0; index < large.length; index++)
      large[index] = index % 251;
    await seed(source, 'changed.txt', data);
    await seed(source, 'large.bin', large);
    await seed(source, 'zero.txt', Buffer.alloc(0));
    await seed(target, 'changed.txt', Buffer.from('old'));
    await client.mkdir(record(target.id), target.path + '/extra');
    await seed(
      { ...target, path: target.path + '/extra' },
      'old.txt',
      Buffer.from('extra'),
    );
    const job = app.get(JobsService).create({
      name: 'M3 topology',
      source: { instanceId: source.id, path: source.path, refresh: true },
      targets: [
        {
          instanceId: target.id,
          path: target.path,
          refresh: true,
          mode: 'mirror',
          deleteLimits: { enabled: false },
        },
      ],
      syncEmptyDirs: true,
    });
    const accepted = app.get(RunsService).trigger(job.id, {
      dryRun: false,
      confirmDeletes: false,
    });
    const result = await settle(accepted.id);
    expect(result.status).toBe('succeeded');
    expect(result.stats).toMatchObject({
      succeededCreates: 3,
      deletedForReplace: 1,
      deletedAsExtra: 1,
    });
    const listing = await client.list(record(target.id), target.path, '', true);
    expect(
      listing.items
        .map(
          /** 取得最终文件名以核对mirror删除结果。
           * @param entry 最终列表条目。
           * @returns 用于当前断言的字段。
           * @throws 不适用。
           */
          (entry) => entry.name,
        )
        .sort(),
    ).toEqual(['changed.txt', 'large.bin', 'zero.txt']);
    expect((await content(target, 'changed.txt')).equals(data)).toBe(true);
    expect((await content(target, 'large.bin')).equals(large)).toBe(true);
  }
  /** 轮询直到Run终态，期限内未结束则返回当前状态供断言失败。
   * @param id Run ID。
   * @returns 最新RunDetail。
   * @throws Error 查询失败。
   */
  async function settle(id: string) {
    const runs = app.get(RunsService);
    let result = runs.get(id);
    const deadline = Date.now() + 50000;
    while (
      !['succeeded', 'partial', 'failed', 'cancelled', 'interrupted'].includes(
        result.status,
      ) &&
      Date.now() < deadline
    ) {
      await delay(50);
      result = runs.get(id);
    }
    return result;
  }
  /** 经目标实例的下载路由读取最终文件字节，独立于被测上传路径。
   * @param target 目标测试目录。
   * @param name 文件原名。
   * @returns 完整文件内容。
   * @throws Error 读取或下载失败。
   */
  async function content(target: Endpoint, name: string): Promise<Buffer> {
    const instance = record(target.id);
    const entry = await client.get(instance, target.path, name);
    const url = downloadUrl(
      instance.baseUrl,
      instance.accountBasePath ?? '/',
      target.path,
      entry.name,
      entry.sign,
      instance.downloadMode,
    );
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    return Buffer.from(await response.arrayBuffer());
  }
  /** 验证同实例同存储。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('L1: same instance and Local storage', async () => {
    await topology(
      { id: primary, path: environment.localPath },
      { id: primary, path: environment.localPath },
    );
  });
  /** 验证同实例跨Local存储。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('L2-relay: same instance across Local storages', async () => {
    await topology(
      { id: primary, path: environment.localPath },
      { id: primary, path: environment.secondLocalPath },
    );
  });
  /** 验证4.2.5作为上传目标。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('L3: 4.2.7 source to 4.2.5 target', async () => {
    await topology(
      { id: primary, path: environment.localPath },
      { id: peer, path: environment.peerLocalPath },
    );
  });
  /** 验证4.2.5作为下载源。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('L3: 4.2.5 source to 4.2.7 target', async () => {
    await topology(
      { id: peer, path: environment.peerLocalPath },
      { id: primary, path: environment.localPath },
    );
  });
  /** 限速使上传停留在session内，取消后Run cancelled、create unknown并已请求abort。
   * @param 不适用。
   * @returns 验证完成。
   * @throws Error 断言失败。
   */
  it('L3: cancels a throttled upload on the 4.2.5 target', async () => {
    const source = await owned({ id: primary, path: environment.localPath });
    const target = await owned({ id: peer, path: environment.peerLocalPath });
    await seed(source, 'slow.bin', Buffer.alloc(12 * 1048576, 7));
    const job = app.get(JobsService).create({
      name: 'M3 cancel',
      source: { instanceId: source.id, path: source.path, refresh: true },
      targets: [{ instanceId: target.id, path: target.path, refresh: true }],
      relayBandwidthLimit: 1048576,
    });
    const runs = app.get(RunsService);
    const accepted = runs.trigger(job.id, {
      dryRun: false,
      confirmDeletes: false,
    });
    let uploadId: string | undefined;
    const deadline = Date.now() + 30000;
    while (!uploadId && Date.now() < deadline) {
      await delay(50);
      uploadId = runs
        .operations(accepted.id, {
          page: 1,
          pageSize: 10,
        })
        .items.map((op) => app.get(OperationsService).get(op.id))
        .find(
          /** 找到已持久化session的create。
           * @param op 当前操作视图。
           * @returns 是否已有multipart事实。
           * @throws 不适用。
           */
          (op) => op.attempts[0].multipart !== null,
        )?.attempts[0].multipart?.uploadId;
    }
    expect(uploadId).toBeDefined();
    runs.cancel(accepted.id);
    const result = await settle(accepted.id);
    expect(result).toMatchObject({
      status: 'cancelled',
      stopReason: 'USER_CANCEL',
    });
    const operation = runs.operations(accepted.id, { page: 1, pageSize: 10 })
      .items[0];
    expect(
      app.get(OperationsService).get(operation.id).attempts[0],
    ).toMatchObject({ status: 'unknown', multipart: { uploadId } });
    // abort不证明驱动已停止；这里只核对OpenList不再把该session当作接收中。
    const after = await uploads.status(record(peer), uploadId ?? '').then(
      /** 读取abort之后的session状态。
       * @param snapshot 仍存在时的快照。
       * @returns 上游state。
       * @throws 不适用。
       */
      (snapshot) => snapshot.state,
      /** session已移除时返回上游码。
       * @param error 查询失败。
       * @returns 应用码或HTTP状态。
       * @throws Error 非协议失败。
       */
      (error: unknown) => {
        if (!(error instanceof OpenListError)) throw error;
        return error.upstreamCode ?? error.httpStatus;
      },
    );
    expect(after).not.toBe('receiving');
  });
});
