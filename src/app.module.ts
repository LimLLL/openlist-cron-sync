// 装配当前已实现的模块，每次应用创建时独立加载环境。
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { Environment } from './configuration/validation.js';
import { InstancesModule } from './instances/instances.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { RunsModule } from './runs/runs.module.js';
import { SystemModule } from './system/system.module.js';

/** 根模块只声明导入，不协调业务初始化。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({
  // 从最深消费模块开始装配，使共享依赖先于其消费方初始化。
  imports: [RunsModule, JobsModule, InstancesModule, SystemModule],
})
export class AppModule {}

/** 每次创建应用时组装环境，禁止在模块 import 时捕获 process.env。
 * @param environment 环境来源，生产默认 process.env；不复制或预读管理员字段。
 * @returns 可交给 NestFactory 或 TestingModule 的相同根模块。
 * @throws Error 开发环境文件读取失败。
 */
export async function createAppModule(
  environment: Environment = process.env,
): Promise<DynamicModule> {
  const configuration = await ConfigModule.forRoot({
    isGlobal: true,
    ignoreEnvFile:
      environment !== process.env || environment.NODE_ENV !== 'development',
    ignoreEnvVars: true,
    skipProcessEnv: true,
    load: [
      /** 保留本次环境对象的引用，bootstrap 字段只在需要时访问。
       * @param 不适用。
       * @returns 本次应用的环境容器。
       * @throws 不适用。
       */
      () => ({ environment }),
    ],
  });
  return { module: AppModule, imports: [configuration] };
}
