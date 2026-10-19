// 装配依赖配置的数据库模块。
import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { DatabaseService } from './database.service.js';
import { ENCRYPTED_COLUMNS, encryptedColumns } from './encrypted-columns.js';

/** 数据库模块，配置生命周期先于连接初始化。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [ConfigurationModule],
  providers: [
    DatabaseService,
    { provide: ENCRYPTED_COLUMNS, useValue: encryptedColumns },
  ],
  exports: [DatabaseService, ENCRYPTED_COLUMNS],
})
export class DatabaseModule {}
