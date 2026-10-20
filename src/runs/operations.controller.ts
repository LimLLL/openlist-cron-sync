// 暴露操作检查、隔离释放和放弃责任API，所有端点要求管理员JWT。
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  HttpCode,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { EmptyQueryDto, ErrorDto } from '../common/http.dto.js';
import { pageSchema } from '../common/api-schema.js';
import { operationViewSchema } from './api-schemas.js';
import { OperationsService } from './operations.service.js';
import {
  OperationsQueryDto,
  ReleaseQuarantineDto,
  ResolveOperationDto,
} from './operations.dto.js';

/** 未知结果管理控制器；没有直接retry或远端删除接口。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@ApiTags('Operations')
@ApiBearerAuth()
@Controller('operations')
export class OperationsController {
  /** 保存具体管理服务。
   * @param operations 操作管理。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(OperationsService) private readonly operations: OperationsService,
  ) {}
  /** 查询所有操作，支持未解决unknown过滤。
   * @param query 分页和过滤。
   * @returns Page OperationView。
   * @throws ApiError 参数错误。
   */
  @Get()
  @ApiOkResponse({ schema: pageSchema(operationViewSchema) })
  list(@Query() query: OperationsQueryDto) {
    return this.operations.list(query);
  }
  /** 读取一个操作及其独立resolution。
   * @param id 操作UUID。
   * @param _query 禁止额外查询。
   * @returns OperationView。
   * @throws ApiError 未找到。
   */
  @Get(':id')
  @ApiOkResponse({ schema: operationViewSchema })
  get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() _query: EmptyQueryDto,
  ) {
    return this.operations.get(id);
  }
  /** 提前释放隔离，后续真实Run仍须refresh；旧写入仍可能迟到。
   * @param id 操作UUID。
   * @param body 非空管理员原因。
   * @param _query 禁止额外查询。
   * @returns OperationView。
   * @throws ApiError 状态非法或未找到。
   */
  @Post(':id/quarantine-release')
  @HttpCode(200)
  @ApiOkResponse({
    schema: operationViewSchema,
    description: '仅释放时间和原因；必须重新观察，旧请求仍可能迟到写入',
  })
  @ApiConflictResponse({ type: ErrorDto, description: 'INVALID_STATE' })
  release(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ReleaseQuarantineDto,
    @Query() _query: EmptyQueryDto,
  ) {
    return this.operations.release(id, body.reason);
  }
  /** 放弃责任，不修复文件也不证明远端动作停止。
   * @param id 操作UUID。
   * @param body abandoned及非空原因。
   * @param _query 禁止额外查询。
   * @returns OperationView。
   * @throws ApiError 状态非法、PATH_BUSY或未找到。
   */
  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOkResponse({
    schema: operationViewSchema,
    description:
      '结束未决责任和刷新义务；不改变unknown结果，不证明旧请求已停止',
  })
  @ApiConflictResponse({
    type: ErrorDto,
    description: 'INVALID_STATE / PATH_BUSY',
  })
  resolve(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ResolveOperationDto,
    @Query() _query: EmptyQueryDto,
  ) {
    return this.operations.abandon(id, body.reason);
  }
}
