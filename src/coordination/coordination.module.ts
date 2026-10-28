// 协调叶子模块持有就绪标志与跨任务目录请求间隔。
import { DatabaseModule } from '../database/database.module.js';
import { PathOccupancy } from './path-occupancy.js';
import { RelayResources } from './relay-resources.js';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { ScanPacing } from './scan-pacing.service.js';
import { RunQueue } from './run-queue.js';
import { Module } from '@nestjs/common';
import { Readiness } from './readiness.js';
import { FatalError } from './fatal-error.js';
import { TaskResources } from './task-resources.js';
export { Readiness } from './readiness.js';

/** 没有反向依赖的协调叶子模块。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [ConfigurationModule, DatabaseModule],
  providers: [
    Readiness,
    FatalError,
    TaskResources,
    ScanPacing,
    RunQueue,
    PathOccupancy,
    RelayResources,
  ],
  exports: [
    Readiness,
    FatalError,
    TaskResources,
    ScanPacing,
    RunQueue,
    PathOccupancy,
    RelayResources,
  ],
})
export class CoordinationModule {}
