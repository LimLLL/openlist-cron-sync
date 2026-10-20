// 装配运行生命周期与操作管理，模块不反向依赖 Jobs/Instances。
import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { SecurityModule } from '../security/security.module.js';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { CoordinationModule } from '../coordination/coordination.module.js';
import { RunsService } from './runs.service.js';
import { RunDispatcher } from './run-dispatcher.service.js';
import { OperationsService } from './operations.service.js';
import { OperationsController } from './operations.controller.js';
import { RunsController } from './runs.controller.js';
/** 真实执行、预览和恢复的运行模块。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [
    SyncModule,
    DatabaseModule,
    SecurityModule,
    ConfigurationModule,
    CoordinationModule,
  ],
  providers: [RunsService, RunDispatcher, OperationsService],
  controllers: [RunsController, OperationsController],
})
export class RunsModule {}
