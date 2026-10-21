// 装配配置与单向调度依赖，提交之后才更新cron。
import { Module } from '@nestjs/common';
import { InstancesModule } from '../instances/instances.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { SecurityModule } from '../security/security.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { JobsService } from './jobs.service.js';
import { JobsController } from './jobs.controller.js';
/** Job 配置模块。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [SchedulingModule, InstancesModule, DatabaseModule, SecurityModule],
  providers: [JobsService],
  controllers: [JobsController],
})
export class JobsModule {}
