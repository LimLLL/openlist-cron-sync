// 定义只读操作历史的分页与过滤契约。
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
import { Optional } from '../instances/input.dto.js';
import { PageQueryDto } from './input.dto.js';
import { OPERATION_STATUSES } from './run-types.js';

/** 全局操作分页查询，不将历史unknown改写为成功。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class OperationsQueryDto extends PageQueryDto {
  /** 可选规范状态。 */
  @ApiPropertyOptional({ enum: OPERATION_STATUSES })
  @Optional()
  @IsIn(OPERATION_STATUSES)
  status?: (typeof OPERATION_STATUSES)[number];
  /** 可选源或目标实例ID。 */
  @ApiPropertyOptional({ format: 'uuid' })
  @Optional()
  @IsUUID('4')
  instanceId?: string;
}
