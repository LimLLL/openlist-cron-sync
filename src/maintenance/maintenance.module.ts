// 装配本地历史与远程task维护，不依赖Runs或Sync。
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { CoordinationModule } from '../coordination/coordination.module.js';
import { OpenListModule } from '../openlist/openlist.module.js';
import { MaintenanceService } from './maintenance.service.js';
import { RemoteTaskMaintenance } from './remote-tasks.js';
import { HistoryRetention } from './history-retention.js';
/** 维护模块。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [
    DatabaseModule,
    ConfigurationModule,
    CoordinationModule,
    OpenListModule,
  ],
  providers: [MaintenanceService, RemoteTaskMaintenance, HistoryRetention],
})
export class MaintenanceModule {}
