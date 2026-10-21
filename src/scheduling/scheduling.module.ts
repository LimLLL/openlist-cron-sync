// 装配动态cron，依赖Runs但不反向依赖Jobs。
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RunsModule } from '../runs/runs.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { CoordinationModule } from '../coordination/coordination.module.js';
import { SchedulingService } from './scheduling.service.js';
/** 动态调度模块。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [
    RunsModule,
    DatabaseModule,
    CoordinationModule,
    ScheduleModule.forRoot(),
  ],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
