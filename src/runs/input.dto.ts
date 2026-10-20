// 定义预览触发与分页查询，M2 明确只接受 dryRun=true。
import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsBoolean, IsDefined, IsIn, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { InstanceQueryDto, Optional } from '../instances/input.dto.js';
import { OPERATION_STATUSES, RUN_STATUSES } from './run-types.js';

/** 只含公共分页字段。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class PageQueryDto extends PickType(InstanceQueryDto, [
  'page',
  'pageSize',
] as const) {}
/** 严格转换 URL 布尔，不把非空字符串视作 true。
 * @param input 转换上下文。
 * @returns 布尔或原值供验证拒绝。
 * @throws 不适用。
 */
function booleanQuery(input: { value: unknown }): unknown {
  return input.value === 'true'
    ? true
    : input.value === 'false'
      ? false
      : input.value;
}
/** M2 触发契约，省略或 false 返回 400 且不创建 Run。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class TriggerRunDto {
  /** M2 必填 true；M3a 才开放真实执行。 */
  @ApiProperty({
    type: Boolean,
    enum: [true],
    description: 'M2 只接受 true；省略或 false 返回 400 VALIDATION_ERROR',
  })
  @IsDefined()
  @IsIn([true])
  dryRun: true;
  /** 仅跳过数量/比例阈值，不能覆盖扫描保护。 */
  @ApiPropertyOptional({
    default: false,
    description: '只覆盖 count/percent；不覆盖 DELETE_BLOCKED',
  })
  @Optional()
  @IsBoolean()
  confirmDeletes = false;
}
/** Run 列表过滤。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class RunQueryDto extends PageQueryDto {
  /** 可选 Job ID，包含其历史 Run。 */
  @ApiPropertyOptional({ format: 'uuid' })
  @Optional()
  @IsUUID('4')
  jobId?: string;
  /** 规范 Run 状态。 */
  @ApiPropertyOptional({ enum: RUN_STATUSES })
  @Optional()
  @IsIn(RUN_STATUSES)
  status?: (typeof RUN_STATUSES)[number];
  /** 可选预览过滤。 */
  @ApiPropertyOptional({ type: Boolean })
  @Optional()
  @Transform(booleanQuery)
  @IsBoolean()
  dryRun?: boolean;
}
/** 按 Run 内 seq 返回的操作过滤。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class OperationQueryDto extends PageQueryDto {
  /** 规范操作状态。 */
  @ApiPropertyOptional({ enum: OPERATION_STATUSES })
  @Optional()
  @IsIn(OPERATION_STATUSES)
  status?: (typeof OPERATION_STATUSES)[number];
  /** 逻辑动作。 */
  @ApiPropertyOptional({ enum: ['mkdir', 'create', 'delete'] })
  @Optional()
  @IsIn(['mkdir', 'create', 'delete'])
  action?: 'mkdir' | 'create' | 'delete';
  /** 是否显示维护操作；M2 不会产生维护操作。 */
  @ApiPropertyOptional({ default: false })
  @Optional()
  @Transform(booleanQuery)
  @IsBoolean()
  includeMaintenance = false;
}
