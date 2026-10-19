// 提供受全局 AuthGuard 保护的实例路由与 OpenAPI 契约。
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiBadGatewayResponse,
} from '@nestjs/swagger';
import { InstancesService } from './instances.service.js';
import { InstanceOperations } from './instance-operations.service.js';
import {
  BrowseRequestDto,
  InstanceCreateDto,
  InstancePatchDto,
  InstanceQueryDto,
  TestRequestDto,
} from './input.dto.js';
import { InstancePage, InstanceView } from './view.dto.js';
import { BrowseResultDto, TestResultDto } from './operations.dto.js';
import { EmptyQueryDto, ErrorDto } from '../common/http.dto.js';

/** 管理员实例端点。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@ApiTags('Instances')
@ApiBearerAuth()
@Controller('instances')
export class InstancesController {
  /** 保存配置与只读操作服务。
   * @param instances 配置服务。
   * @param operations 测试与浏览。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    @Inject(InstancesService) private readonly instances: InstancesService,
    @Inject(InstanceOperations) private readonly operations: InstanceOperations,
  ) {}
  /** 创建实例。
   * @param body 完整配置。
   * @param _query 禁止查询参数。
   * @returns 公开视图。
   * @throws ApiError 验证失败。
   */
  @Post()
  @ApiCreatedResponse({ type: InstanceView })
  create(
    @Body() body: InstanceCreateDto,
    @Query() _query: EmptyQueryDto,
  ): InstanceView {
    return this.instances.create(body);
  }
  /** 分页读取实例。
   * @param query 分页参数。
   * @returns 分页结果。
   * @throws ApiError 参数错误。
   */
  @Get()
  @ApiOkResponse({ type: InstancePage })
  list(@Query() query: InstanceQueryDto): InstancePage {
    return this.instances.list(query);
  }
  /** 读取单实例。
   * @param id UUIDv4。
   * @param _query 禁止查询参数。
   * @returns 公开视图。
   * @throws ApiError 不存在。
   */
  @Get(':id')
  @ApiOkResponse({ type: InstanceView })
  get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() _query: EmptyQueryDto,
  ): InstanceView {
    return this.instances.get(id);
  }
  /** 更新配置，不访问上游。
   * @param id UUIDv4。
   * @param body 补丁。
   * @param _query 禁止查询参数。
   * @returns 公开视图。
   * @throws ApiError 参数错误或不存在。
   */
  @Patch(':id')
  @ApiOkResponse({ type: InstanceView })
  patch(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: InstancePatchDto,
    @Query() _query: EmptyQueryDto,
  ): InstanceView {
    return this.instances.patch(id, body);
  }
  /** 归档实例并清除凭据。
   * @param id UUIDv4。
   * @param _query 禁止查询参数。
   * @returns 不适用。
   * @throws ApiError 不存在。
   */
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  archive(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() _query: EmptyQueryDto,
  ): void {
    this.instances.archive(id);
  }
  /** 执行只读连接测试。
   * @param id UUIDv4。
   * @param body 人工恢复选项。
   * @param _query 禁止查询参数。
   * @returns 测试结果，包括上游失败。
   * @throws ApiError 冷却期或本地错误。
   */
  @Post(':id/test')
  @HttpCode(200)
  @ApiOkResponse({ type: TestResultDto })
  @ApiConflictResponse({
    type: ErrorDto,
    description: 'AUTH_COOLDOWN：人工重试仍处于 429 冷却期',
  })
  test(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: TestRequestDto,
    @Query() _query: EmptyQueryDto,
  ): Promise<TestResultDto> {
    return this.operations.test(id, body);
  }
  /** 浏览目录。
   * @param id UUIDv4。
   * @param body 路径和分页。
   * @param _query 禁止查询参数。
   * @returns 安全列表。
   * @throws ApiError INVALID_PATH 或 502 上游失败。
   */
  @Post(':id/browse')
  @HttpCode(200)
  @ApiOkResponse({ type: BrowseResultDto })
  @ApiBadGatewayResponse({
    type: ErrorDto,
    description: 'OPENLIST_ERROR / UPSTREAM_PROTOCOL_ERROR',
  })
  browse(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: BrowseRequestDto,
    @Query() _query: EmptyQueryDto,
  ): Promise<BrowseResultDto> {
    return this.operations.browse(id, body);
  }
}
