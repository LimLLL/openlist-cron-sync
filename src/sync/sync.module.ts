// 装配扫描、执行与Relay协作，不引入后续通知模块。
import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { SecurityModule } from '../security/security.module.js';
import { OpenListModule } from '../openlist/openlist.module.js';
import { RelayModule } from '../relay/relay.module.js';
import { CoordinationModule } from '../coordination/coordination.module.js';
import { CopyTracker } from './copy-tracker.js';
import { ExecutionRecovery } from './execution-recovery.js';
import { Executor } from './executor.service.js';
import { SyncService } from './sync.service.js';
/** 扫描规划与具体执行模块。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [
    ConfigurationModule,
    RelayModule,
    OpenListModule,
    SecurityModule,
    DatabaseModule,
    CoordinationModule,
  ],
  providers: [SyncService, Executor, CopyTracker, ExecutionRecovery],
  exports: [SyncService, Executor],
})
export class SyncModule {}
