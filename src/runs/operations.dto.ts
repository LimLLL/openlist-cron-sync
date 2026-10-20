// 定义未知结果查询及两种独立管理动作的公开契约。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
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
  /** true仅未解决unknown；false排除此集合；省略不筛选。 */
  @ApiPropertyOptional({ type: Boolean })
  @Optional()
  @Transform(
    /** 严格解析查询布尔，保留非法值交给ValidationPipe拒绝。
     * @param input 当前输入值。
     * @returns 布尔值或原始非法输入。
     * @throws 不适用。
     */
    ({ value }: { value: unknown }) =>
      value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unresolved?: boolean;
}
/** 提前释放仅记录事实，下一次真实Run仍须刷新。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class ReleaseQuarantineDto {
  /** 1–1000字符且不能只有空白；不得填写凭据。 */
  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @IsString()
  @Length(1, 1000)
  @Matches(/\S/u)
  reason: string;
}
/** 放弃未知责任；不是修复目标，也不证明旧请求已停止。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class ResolveOperationDto extends ReleaseQuarantineDto {
  /** 仅允许abandoned；observed/superseded由真实Run产生。 */
  @ApiProperty({ enum: ['abandoned'] })
  @IsIn(['abandoned'])
  kind: 'abandoned';
}
