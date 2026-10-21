// 声明Job调度查询的严格DTO及OpenAPI边界。
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { queryInteger } from '../instances/input.dto.js';
/** 未来发生时刻的最大返回数量。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class NextFireQueryDto {
  /** 默认5，1–20；仅返回cron库搜索范围内的前缀。 */
  @ApiPropertyOptional({
    default: 5,
    minimum: 1,
    maximum: 20,
    description: '最大数量；稀疏表达式可能返回更短前缀',
  })
  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(20)
  count = 5;
}
