// 装配协议客户端，实例配置由调用方提供，模块不导入 Instances。
import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { SecurityModule } from '../security/security.module.js';
import { CoordinationModule } from '../coordination/coordination.module.js';
import { OpenListTransport } from './transport.service.js';
import { OpenListAuth } from './auth.service.js';
import { OpenListClient } from './client.service.js';
import { OpenListTasks } from './tasks.service.js';
import { OpenListMultipart } from './multipart.service.js';
/** 无反向依赖的 OpenList 协议模块。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  imports: [ConfigurationModule, SecurityModule, CoordinationModule],
  providers: [
    OpenListTransport,
    OpenListAuth,
    OpenListClient,
    OpenListTasks,
    OpenListMultipart,
  ],
  exports: [OpenListClient, OpenListTasks, OpenListMultipart],
})
export class OpenListModule {}
