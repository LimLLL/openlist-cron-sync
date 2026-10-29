// 组合真实 Nest、SQLite 和 F1，验证预览完整入口而非替换内部服务。
import type { Environment } from '../src/configuration/validation.js';
import { InstanceOperations } from '../src/instances/instance-operations.service.js';
import { JobsService } from '../src/jobs/jobs.service.js';
import { RunsService } from '../src/runs/runs.service.js';
import { object, string } from '../src/openlist/errors.js';
import { componentFixture, envelope, file } from './openlist-fixture.js';
import type { ComponentFixture, Reply } from './openlist-fixture.js';
import type { Job } from '../src/jobs/job-types.js';
import { OperationsService } from '../src/runs/operations.service.js';

/** M2 组件夹具。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export interface M2Fixture extends ComponentFixture {
  /** 按账号路径提供完整列表或错误。 */
  tree: Map<string, Reply>;
  /** 当前 Job 服务。 */
  jobs: () => JobsService;
  /** 当前 Run 服务。 */
  runs: () => RunsService;
  /** 创建默认源和目标的 Job。 */
  job: (overrides?: Record<string, unknown>) => Job;
  /** 创建默认源和 server_copy 目标的 Job。 */
  copyJob: (overrides?: Record<string, unknown>) => Job;
}
/** 构造完整成功列表。
 * @param entries 上游条目。
 * @returns F1 envelope。
 * @throws 不适用。
 */
export function listing(...entries: Record<string, unknown>[]): Reply {
  return envelope({ content: entries, total: entries.length, write: true });
}
/** 构造目录条目。
 * @param name 原始名称。
 * @returns 上游目录。
 * @throws 不适用。
 */
export function directory(name: string): Record<string, unknown> {
  return { ...file(name), size: 0, is_dir: true };
}
/** 初始化已测试端点和可控目录树。
 * @param settings 环境差异。
 * @returns 可运行预览的夹具。
 * @throws Error 初始化失败。
 */
export async function m2Fixture(
  settings: Environment = {},
): Promise<M2Fixture> {
  const f = await componentFixture('token', {
    PLAN_BATCH_SIZE: '1',
    RETRY_MAX_ATTEMPTS: '1',
    ...settings,
  });
  await f.app.get(InstanceOperations).test(f.id, { retryAuth: false });
  const tree = new Map<string, Reply>([
    ['/source', listing(file('new.txt'))],
    ['/target', listing()],
  ]);
  f.server.responder =
    /** 列表请求按路径返回可控目录树，未登记路径返回 500；其它端点用默认响应。
     * @param call 捕获的真实 HTTP 请求。
     * @returns 列表响应或 undefined 以使用默认响应。
     * @throws 不适用。
     */
    (call) =>
      call.url === '/api/fs/list'
        ? (tree.get(string(object(call.json).path)) ?? envelope(null, 500))
        : undefined;
  /** 以默认源 /source 和目标 /target 创建 Job。
   * @param overrides 覆盖默认创建请求的字段。
   * @returns 已持久化的 Job。
   * @throws Error 创建请求校验失败。
   */
  const job = (overrides: Record<string, unknown> = {}) =>
    f.app.get(JobsService).create({
      name: 'Preview',
      source: { instanceId: f.id, path: '/source' },
      targets: [{ instanceId: f.id, path: '/target' }],
      ...overrides,
    });
  return Object.assign(f, {
    tree,
    /** 读取当前应用中的 Job 服务。
     * @param 不适用。
     * @returns JobsService 实例。
     * @throws Error 应用已关闭或服务未注册。
     */
    jobs: () => f.app.get(JobsService),
    /** 读取当前应用中的 Run 服务。
     * @param 不适用。
     * @returns RunsService 实例。
     * @throws Error 应用已关闭或服务未注册。
     */
    runs: () => f.app.get(RunsService),
    job,
    /** 以默认源 /source 和同实例 server_copy 目标 /target 创建 Job。
     * @param overrides 覆盖默认创建请求的字段。
     * @returns 已持久化的 Job。
     * @throws Error 创建请求校验失败。
     */
    copyJob: (overrides: Record<string, unknown> = {}) =>
      job({
        targets: [
          { instanceId: f.id, path: '/target', createMode: 'server_copy' },
        ],
        ...overrides,
      }),
  });
}
/** 等待真实后台运行进入终态，不假定固定扫描耗时。
 * @param fixture 当前夹具。
 * @param id Run ID。
 * @returns 固定后的 RunDetail。
 * @throws Error 断言超时。
 */
export async function terminal(
  fixture: M2Fixture,
  id: string,
): Promise<ReturnType<RunsService['get']>> {
  await vi.waitFor(
    /** 断言 Run 已进入任一终态。
     * @param 不适用。
     * @returns 不适用。
     * @throws Error 尚未进入终态，由 waitFor 重试。
     */
    () =>
      expect([
        'succeeded',
        'partial',
        'failed',
        'cancelled',
        'interrupted',
      ]).toContain(fixture.runs().get(id).status),
    { timeout: 5000, interval: 10 },
  );
  return fixture.runs().get(id);
}
/** 触发并等待一次完整 dry-run。
 * @param fixture 夹具。
 * @param job Job。
 * @param confirmDeletes 是否覆盖阈值。
 * @returns RunDetail。
 * @throws Error 触发或断言失败。
 */
export async function preview(
  fixture: M2Fixture,
  job: Job,
  confirmDeletes = false,
) {
  return terminal(
    fixture,
    fixture.runs().trigger(job.id, { dryRun: true, confirmDeletes }).id,
  );
}
/** 获取测试小计划的完整列表。
 * @param fixture 夹具。
 * @param id Run ID。
 * @returns 操作列表。
 * @throws Error 查询失败。
 */
export function plan(fixture: M2Fixture, id: string) {
  return fixture
    .runs()
    .operations(id, { page: 1, pageSize: 200 })
    .items.map((row) => fixture.app.get(OperationsService).get(row.id));
}
