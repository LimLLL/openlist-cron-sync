// 装配预览运行协调，模块不反向依赖 Jobs/Instances。
import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { SecurityModule } from '../security/security.module.js';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { CoordinationModule } from '../coordination/coordination.module.js';
import { RunsService } from './runs.service.js';
import { RunDispatcher } from './run-dispatcher.service.js';
import { RunsController } from './runs.controller.js';
/** M2 运行模块。
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
  providers: [RunsService, RunDispatcher],
  controllers: [RunsController],
})
export class RunsModule {}
