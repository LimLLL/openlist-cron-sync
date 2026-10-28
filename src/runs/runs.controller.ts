// 提供执行触发、取消及分页查询，所有路由受全局管理员认证保护。
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { EmptyQueryDto, ErrorDto } from '../common/http.dto.js';
import { pageSchema } from '../common/api-schema.js';
import {
  TriggerRunDto,
  RunQueryDto,
  OperationQueryDto,
  PageQueryDto,
} from './input.dto.js';
import { RunsService } from './runs.service.js';
import {
  runViewSchema,
  runListItemSchema,
  runDetailSchema,
  operationViewSchema,
  issueViewSchema,
} from './api-schemas.js';

/** 运行 REST 控制器；手动触发归 Runs 所有。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@ApiTags('Runs')
@ApiBearerAuth()
@Controller()
export class RunsController {
  /** 保存运行服务。
   * @param runs 运行入口及查询。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(@Inject(RunsService) private readonly runs: RunsService) {}
  /** 创建运行；202只表示已接受，不承诺执行成功。
   * @param id Job UUID。
   * @param body 真实执行或预览参数。
   * @param _query 禁止额外查询。
   * @param response 用于 Location 头。
   * @returns 已提交的 queued RunView。
   * @throws ApiError 验证、JOB_BUSY、QUEUE_FULL 或 NOT_READY。
   */
  @Post('jobs/:id/runs')
  @HttpCode(202)
  @ApiAcceptedResponse({
    schema: runViewSchema,
    description:
      'Location=/api/v1/runs/:id；预览不会执行远程写入；重复请求无幂等键',
  })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description: 'VALIDATION_ERROR：端点配置不可运行',
  })
  @ApiConflictResponse({
    type: ErrorDto,
    description: 'JOB_BUSY / PATH_OVERLAP',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorDto,
    description: 'QUEUE_FULL / NOT_READY',
  })
  trigger(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: TriggerRunDto,
    @Query() _query: EmptyQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const run = this.runs.trigger(id, body);
    response.setHeader('Location', `/api/v1/runs/${run.id}`);
    return run;
  }
  /** 取消运行，终态返回200，其他状态返回202。
   * @param id Run UUID。
   * @param _body 空请求体。
   * @param _query 禁止额外查询。
   * @param response 用于动态HTTP状态。
   * @returns 当前RunView。
   * @throws ApiError Run不存在。
   */
  @Post('runs/:id/cancel')
  @ApiAcceptedResponse({ schema: runViewSchema })
  @ApiOkResponse({ schema: runViewSchema })
  cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() _body: EmptyQueryDto,
    @Query() _query: EmptyQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const before = this.runs.record(id);
    const terminal = [
      'succeeded',
      'partial',
      'failed',
      'cancelled',
      'interrupted',
    ].includes(before.status);
    const result = this.runs.cancel(id);
    response.status(terminal ? 200 : 202);
    return result;
  }
  /** 分页查询运行历史。
   * @param query 过滤及分页。
   * @returns Page RunListItem，含冻结Job名称及当前页实时统计。
   * @throws ApiError 查询错误或实时聚合RESOURCE_LIMIT。
   */
  @Get('runs')
  @ApiOkResponse({ schema: pageSchema(runListItemSchema) })
  @ApiInternalServerErrorResponse({
    type: ErrorDto,
    description: 'RESOURCE_LIMIT：实时聚合超过安全整数；读取不改变Run状态',
  })
  list(@Query() query: RunQueryDto) {
    return this.runs.list(query);
  }
  /** 读取固定快照和目标汇总。
   * @param id Run UUID。
   * @param _query 禁止查询字段。
   * @returns RunDetail。
   * @throws ApiError 不存在。
   */
  @Get('runs/:id')
  @ApiOkResponse({ schema: runDetailSchema })
  @ApiInternalServerErrorResponse({
    type: ErrorDto,
    description: 'RESOURCE_LIMIT：实时聚合超过安全整数；读取不改变Run状态',
  })
  get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() _query: EmptyQueryDto,
  ) {
    return this.runs.get(id);
  }
  /** 返回按 seq 排序的计划操作。
   * @param id Run UUID。
   * @param query 过滤及分页。
   * @returns Page OperationView。
   * @throws ApiError 不存在或查询错误。
   */
  @Get('runs/:id/operations')
  @ApiOkResponse({ schema: pageSchema(operationViewSchema) })
  operations(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: OperationQueryDto,
  ) {
    return this.runs.operations(id, query);
  }
  /** 返回扫描问题，包含提示/警告。
   * @param id Run UUID。
   * @param query 分页。
   * @returns Page ScanIssueView。
   * @throws ApiError 不存在或查询错误。
   */
  @Get('runs/:id/issues')
  @ApiOkResponse({ schema: pageSchema(issueViewSchema) })
  issues(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: PageQueryDto,
  ) {
    return this.runs.issues(id, query);
  }
}
