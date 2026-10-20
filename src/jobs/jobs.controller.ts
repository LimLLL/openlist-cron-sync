// 暴露受管理员 JWT 保护的 Job CRUD 与完整 OpenAPI。
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JobsService } from './jobs.service.js';
import { JobInputDto } from './input.dto.js';
import { InstanceQueryDto } from '../instances/input.dto.js';
import { EmptyQueryDto, ErrorDto } from '../common/http.dto.js';
import {
  jobCreateSchema,
  jobPatchSchema,
  jobViewSchema,
} from './api-schemas.js';
import { pageSchema } from '../common/api-schema.js';

/** Job REST 控制器。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@ApiTags('Jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  /** 保存配置服务。
   * @param jobs 配置服务。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}
  /** 创建 Job。
   * @param body 完整请求。
   * @param _query 禁止额外查询。
   * @returns 新公共配置。
   * @throws ApiError 验证或引用失败。
   */
  @Post()
  @ApiBody({ schema: jobCreateSchema })
  @ApiCreatedResponse({ schema: jobViewSchema })
  create(@Body() body: JobInputDto, @Query() _query: EmptyQueryDto) {
    return this.jobs.create(body);
  }
  /** 分页查询 Job。
   * @param query 分页及归档过滤。
   * @returns 公共列表。
   * @throws ApiError 查询错误。
   */
  @Get()
  @ApiOkResponse({ schema: pageSchema(jobViewSchema) })
  list(@Query() query: InstanceQueryDto) {
    return this.jobs.list(query.page, query.pageSize, query.includeArchived);
  }
  /** 获取活动 Job。
   * @param id UUIDv4。
   * @param _query 禁止查询字段。
   * @returns 公共配置。
   * @throws ApiError 不存在。
   */
  @Get(':id')
  @ApiOkResponse({ schema: jobViewSchema })
  get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() _query: EmptyQueryDto,
  ) {
    return this.jobs.get(id);
  }
  /** 按规范合并配置，运行期间拒绝。
   * @param id UUIDv4。
   * @param body 补丁。
   * @param _query 禁止查询字段。
   * @returns 更新后的公共配置。
   * @throws ApiError JOB_BUSY、PATH_OVERLAP 或非法字段。
   */
  @Patch(':id')
  @ApiBody({ schema: jobPatchSchema })
  @ApiOkResponse({ schema: jobViewSchema })
  @ApiConflictResponse({
    type: ErrorDto,
    description: 'JOB_BUSY / PATH_OVERLAP',
  })
  patch(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: JobInputDto,
    @Query() _query: EmptyQueryDto,
  ) {
    return this.jobs.patch(id, body);
  }
  /** 归档 Job 配置，成员目标随父 Job 一起失效；不删除历史 Run。
   * @param id UUIDv4。
   * @param _query 禁止查询字段。
   * @returns 不适用。
   * @throws ApiError JOB_BUSY 或不存在。
   */
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiConflictResponse({ type: ErrorDto, description: 'JOB_BUSY' })
  archive(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() _query: EmptyQueryDto,
  ): void {
    this.jobs.archive(id);
  }
}
