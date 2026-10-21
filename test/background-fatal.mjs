// 用子进程验证scheduler和maintenance包装器不能吞掉真实持久化异常。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const kind of ['cron', 'maintenance']) {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import 'reflect-metadata';
    import { SchedulerRegistry } from '@nestjs/schedule';
    import { Readiness } from './dist/coordination/readiness.js';
    import { FatalError } from './dist/coordination/fatal-error.js';
    import { SchedulingService } from './dist/scheduling/scheduling.service.js';
    import { MaintenanceService } from './dist/maintenance/maintenance.service.js';
    const readiness = new Readiness({ shutdownGraceSeconds: 1 });
    readiness.recovered = true; readiness.ready = true;
    const fatal = new FatalError(readiness);
    const error = new Error('secret SQL parameters must not escape');
    error.code = 'SQLITE_FULL';
    /** 模拟数据库拒绝持久化。
     * @param 不适用。
     * @returns 不返回。
     * @throws Error SQLITE_FULL。
     */
    const fail = () => { throw error; };
    if ('${kind}' === 'cron') {
      const registry = new SchedulerRegistry();
      const scheduling = new SchedulingService({}, registry, { trigger: fail }, readiness, fatal);
      scheduling.sync({ id: 'fixture', enabled: true, cron: '0 0 1 1 *', timezone: 'UTC', archivedAt: null });
      await registry.getCronJob('fixture').fireOnTick();
    } else {
      new MaintenanceService(readiness, fatal, { cycle: fail }, {}).request('remote');
    }
  `,
    ],
    { cwd: root, encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, `${kind} swallowed fatal error`);
  assert(!result.stdout.includes('secret SQL parameters'));
  assert(!result.stderr.includes('secret SQL parameters'));
}
console.log(
  'PASS background fatal smoke: cron and maintenance exit nonzero without SQL parameter leakage (2/2)',
);
