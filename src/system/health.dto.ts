// 定义公开健康响应，仅包含最低状态。
import { ApiProperty } from '@nestjs/swagger';

/** 存活响应。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class LiveView {
  /** 固定存活状态。 */
  @ApiProperty({ enum: ['ok'] })
  status: 'ok';
}

/** 就绪响应，不含路径、用户名或其他内部状态。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class HealthView {
  /** 综合就绪状态。 */
  @ApiProperty({ enum: ['ok', 'not_ready'] })
  status: 'ok' | 'not_ready';
  /** 数据库只读检查结果。 */
  @ApiProperty({ enum: ['ok', 'error'] })
  database: 'ok' | 'error';
}
