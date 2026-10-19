// 暴露无认证的最低存活与就绪检查。
import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DatabaseService } from '../database/database.service.js';
import { Readiness } from '../coordination/coordination.module.js';
import { Public } from '../security/auth.guard.js';
import { EmptyQueryDto } from '../common/http.dto.js';
import { HealthView, LiveView } from './health.dto.js';

/** 健康控制器。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Public()
@ApiTags('system')
@Controller('system/health')
export class SystemController {
  /** 保存健康检查依赖。
   * @param database 数据库。
   * @param readiness 协调模块中的 ready 标志。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(Readiness) private readonly readiness: Readiness,
  ) {}

  /** 仅确认 HTTP 进程可响应。
   * @param _query 必须为空的查询。
   * @returns 存活状态。
   * @throws 不适用。
   */
  @Get('live')
  @ApiOkResponse({ type: LiveView })
  live(@Query() _query: EmptyQueryDto): LiveView {
    return { status: 'ok' };
  }

  /** 根据初始化状态与数据库检查返回 200 或 503。
   * @param response Express 响应，仅用于设置状态。
   * @param _query 必须为空的查询。
   * @returns 最低健康信息。
   * @throws 不适用；数据库异常转换为 error 状态。
   */
  @Get('ready')
  @ApiOkResponse({ type: HealthView })
  @ApiResponse({ status: 503, type: HealthView })
  ready(
    @Res({ passthrough: true }) response: Response,
    @Query() _query: EmptyQueryDto,
  ): HealthView {
    const database = this.database.healthy() ? 'ok' : 'error';
    const ready = this.readiness.ready && database === 'ok';
    response.status(ready ? 200 : 503);
    return { status: ready ? 'ok' : 'not_ready', database };
  }
}
