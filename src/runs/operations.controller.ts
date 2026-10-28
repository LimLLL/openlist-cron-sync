// 暴露只读操作历史 API，所有端点要求管理员 JWT。
import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { EmptyQueryDto } from '../common/http.dto.js';
import { pageSchema } from '../common/api-schema.js';
import { operationViewSchema } from './api-schemas.js';
import { OperationsService } from './operations.service.js';
import { OperationsQueryDto } from './operations.dto.js';

/** 操作历史控制器；没有直接 retry 或远端删除接口。
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
  /** 查询所有操作，支持状态与实例过滤。
   * @param query 分页和过滤。
   * @returns Page OperationView。
   * @throws ApiError 参数错误。
   */
  @Get()
  @ApiOkResponse({ schema: pageSchema(operationViewSchema) })
  list(@Query() query: OperationsQueryDto) {
    return this.operations.list(query);
  }
  /** 读取一个操作的历史结果。
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
}
