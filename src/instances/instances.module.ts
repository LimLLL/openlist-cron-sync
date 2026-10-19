// 装配实例管理，保持数据库、安全与 OpenList 的单向依赖。
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { SecurityModule } from '../security/security.module.js';
import { OpenListModule } from '../openlist/openlist.module.js';
import { InstancesService } from './instances.service.js';
import { InstanceOperations } from './instance-operations.service.js';
import { InstancesController } from './instances.controller.js';
/** 实例管理模块。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [OpenListModule, SecurityModule, DatabaseModule],
  providers: [InstancesService, InstanceOperations],
  controllers: [InstancesController],
  exports: [InstancesService],
})
export class InstancesModule {}
