// 定义连接测试与目录浏览的公共响应，不含 sign、raw_url 或凭据。
import { ApiProperty } from '@nestjs/swagger';
import { DiagnosticView } from './view.dto.js';

/** 已确认的 OpenList 账号身份。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class AccountView {
  /** 账号名。 */
  @ApiProperty({})
  username: string;
  /** 账号全局根路径。 */
  @ApiProperty({})
  basePath: string;
  /** 0 普通用户，2 管理员；guest 不成功。 */
  @ApiProperty({ type: 'integer' })
  role: number;
  /** 权限位图。 */
  @ApiProperty({ type: 'integer' })
  permissions: number;
}

/** 只读连接测试结果，失败仍返回 HTTP 200。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class TestResultDto {
  /** 是否收到上游响应。 */
  @ApiProperty({})
  reachable: boolean;
  /** 是否确认非 guest 身份。 */
  @ApiProperty({})
  authenticated: boolean;
  /** 已确认账号；失败时可为 null。 */
  @ApiProperty({ type: AccountView, nullable: true })
  account: AccountView | null;
  /** 能力限制与挂载警告。 */
  @ApiProperty({ type: [DiagnosticView] })
  warnings: DiagnosticView[];
  /** 失败原因或 null。 */
  @ApiProperty({ type: DiagnosticView, nullable: true })
  error: DiagnosticView | null;
}

/** 浏览合法条目，不含 sign 或 raw_url。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class BrowseItemDto {
  /** 原始名称。 */
  @ApiProperty({})
  name: string;
  /** 字节数；未知时 null。 */
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    nullable: true,
  })
  size: number | null;
  /** 是否目录。 */
  @ApiProperty({})
  isDir: boolean;
  /** 上游修改时间；未知时 null。 */
  @ApiProperty({ type: String, nullable: true })
  modified: string | null;
}

/** 本地分页浏览结果。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class BrowseResultDto {
  /** 规范化请求路径。 */
  @ApiProperty({})
  path: string;
  /** 本页合法条目。 */
  @ApiProperty({ type: [BrowseItemDto] })
  items: BrowseItemDto[];
  /** 页号。 */
  @ApiProperty({ type: 'integer' })
  page: number;
  /** 页大小。 */
  @ApiProperty({ type: 'integer' })
  pageSize: number;
  /** 可用条目总数，不含非法名称。 */
  @ApiProperty({ type: 'integer' })
  total: number;
  /** 上游目录 write 提示。 */
  @ApiProperty({})
  write: boolean;
  /** 非法名称或挂载风险提示。 */
  @ApiProperty({ type: [DiagnosticView] })
  warnings: DiagnosticView[];
}
