// 装配 M2 配置模块，调度 hook 随 M4 加入。
import { Module } from '@nestjs/common';
import { InstancesModule } from '../instances/instances.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { SecurityModule } from '../security/security.module.js';
import { JobsService } from './jobs.service.js';
import { JobsController } from './jobs.controller.js';
/** Job 配置模块。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [InstancesModule, DatabaseModule, SecurityModule],
  providers: [JobsService],
  controllers: [JobsController],
})
export class JobsModule {}
