// 装配 M2 扫描模块，不引入 Relay 或通知执行依赖。
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { SecurityModule } from '../security/security.module.js';
import { OpenListModule } from '../openlist/openlist.module.js';
import { SyncService } from './sync.service.js';
/** 只读扫描规划模块。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [OpenListModule, SecurityModule, DatabaseModule],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
