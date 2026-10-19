// 提供应用配置及其初始化生命周期。
import { Module } from '@nestjs/common';
import { AppConfig } from './app-config.js';

/** 配置叶子模块。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Module({ providers: [AppConfig], exports: [AppConfig] })
export class ConfigurationModule {}
