// 装配relay流水线；不反向依赖Sync或Runs。
import { Module } from '@nestjs/common';
import { OpenListModule } from '../openlist/openlist.module.js';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { CoordinationModule } from '../coordination/coordination.module.js';
import { RelayService } from './relay.service.js';
import { Spool } from './spool.js';
/** relay具体模块。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [OpenListModule, ConfigurationModule, CoordinationModule],
  providers: [RelayService, Spool],
  exports: [RelayService, Spool],
})
export class RelayModule {}
