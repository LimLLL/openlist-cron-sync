// 定义所有 HTTP 错误使用的公共 DTO。
import { ApiProperty } from '@nestjs/swagger';

/** 无查询字段的请求，白名单校验拒绝任意新增字段。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class EmptyQueryDto {}

/** 公共字段错误。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class FieldErrorDto {
  /** 字段名，不包含字段值。 */
  @ApiProperty({ type: String })
  field: string;
  /** 固定错误原因。 */
  @ApiProperty({ type: String })
  reason: string;
}

/** 公共错误内容。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class ErrorContentDto {
  /** REST 规范中的错误码。 */
  @ApiProperty({ type: String })
  code: string;
  /** 不含秘密或堆栈的摘要。 */
  @ApiProperty({ type: String })
  message: string;
  /** 字段错误；没有时为空数组。 */
  @ApiProperty({ type: [FieldErrorDto] })
  details: FieldErrorDto[];
}

/** 公共 HTTP 错误封装。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class ErrorDto {
  /** 错误详情。 */
  @ApiProperty({ type: ErrorContentDto })
  error: ErrorContentDto;
  /** 服务生成的 UUID，与 X-Request-Id 相同。 */
  @ApiProperty({ type: String, format: 'uuid' })
  requestId: string;
}
