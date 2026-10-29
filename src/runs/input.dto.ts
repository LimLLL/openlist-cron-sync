// 定义真实relay触发、dry-run与分页查询，默认真实执行。
import { ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsUUID } from 'class-validator';
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
/** 两种创建方式共用的执行触发契约。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class TriggerRunDto {
  /** 默认真实执行；true只扫描规划。 */
  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description:
      'true只预览；false按各Target的relay/server_copy创建方式真实执行',
  })
  @Optional()
  @IsBoolean()
  dryRun = false;
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
  /** 规范Run状态，或仅用于列表查询的全部非终态简写。 */
  @ApiPropertyOptional({
    enum: [...RUN_STATUSES, 'active'],
    description:
      'active匹配queued/scanning/planned/executing/cancelling/recovering；响应仍返回实际状态',
  })
  @Optional()
  @IsIn([...RUN_STATUSES, 'active'])
  status?: (typeof RUN_STATUSES)[number] | 'active';
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
}

/** 范围重试只接受删除数值阈值覆盖；路径由服务端历史提取。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class RetryRunDto extends PickType(TriggerRunDto, [
  'confirmDeletes',
] as const) {}
