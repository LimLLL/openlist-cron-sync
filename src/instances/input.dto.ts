// 定义实例管理请求，严格拒绝 null、隐式类型转换和未知字段。
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  Length,
  Min,
  Max,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { ValidationArguments } from 'class-validator';

/** 只允许省略字段，不把 null 当省略。
 * @param 不适用。
 * @returns 验证条件装饰器。
 * @throws 不适用。
 */
export function Optional(): PropertyDecorator {
  return ValidateIf(
    /** 判断字段是否存在。
     * @param _object 所属 DTO。
     * @param value 字段值。
     * @returns 是否执行校验。
     * @throws 不适用。
     */
    (_object: unknown, value: unknown) => value !== undefined,
  );
}
/** 严格解析查询中的十进制整数。
 * @param input 转换上下文。
 * @returns 数字或保留原值由验证器拒绝。
 * @throws 不适用。
 */
export function queryInteger(input: { value: unknown }): unknown {
  return typeof input.value === 'string' && /^\d+$/.test(input.value)
    ? Number(input.value)
    : input.value;
}
/** 严格解析查询布尔。
 * @param input 转换上下文。
 * @returns 布尔或原值。
 * @throws 不适用。
 */
function queryBoolean(input: { value: unknown }): unknown {
  if (input.value === 'true') return true;
  if (input.value === 'false') return false;
  return input.value;
}
/** 认证判别联合的运行时校验。
 * @param 不适用。
 * @returns username 验证装饰器。
 * @throws 不适用。
 */
function AuthUsername(): PropertyDecorator {
  return ValidateBy({
    name: 'authUsername',
    validator: {
      /** password 必填 username，token 禁止 username。
       * @param value 字段值。
       * @param args 所属对象。
       * @returns 是否满足判别约束。
       * @throws 不适用。
       */
      validate(value: unknown, args?: ValidationArguments): boolean {
        const object = args?.object;
        if (!object || !('mode' in object)) return false;
        return object.mode === 'password'
          ? typeof value === 'string' && value.length > 0
          : value === undefined;
      },
    },
  });
}
/** 整体替换的认证输入。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class AuthInputDto {
  /** token 或 password，必填。 */
  @ApiProperty({ enum: ['token', 'password'] })
  @IsIn(['token', 'password'])
  mode: 'token' | 'password';
  /** password 模式必填非空；token 模式禁止提供。 */
  @ApiPropertyOptional({
    description: '仅 password 模式必填；token 模式禁止',
    minLength: 1,
  })
  @AuthUsername()
  username?: string;
  /** 非空原始凭据，不接受 null 或掩码。 */
  @ApiProperty({ writeOnly: true, format: 'password', minLength: 1 })
  @IsString()
  @Length(1)
  secret: string;
}
/** 配额字段按字段合并，所有单位与范围见配置参考。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class InstanceLimitsDto {
  /** API 并发，默认 4，0 表示不限。 */
  @ApiPropertyOptional({
    type: 'integer',
    default: 4,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @Optional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  maxApiConcurrency?: number;
  /** 每秒 API 请求数，默认 5，0 表示不限。 */
  @ApiPropertyOptional({
    type: 'integer',
    default: 5,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @Optional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  apiRequestsPerSecond?: number;
  /** 未完成复制任务数，默认 4，0 表示不限。 */
  @ApiPropertyOptional({
    type: 'integer',
    default: 4,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @Optional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  maxOutstandingTasks?: number;
  /** 下载连接，默认 2，0 表示不限。 */
  @ApiPropertyOptional({
    type: 'integer',
    default: 2,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @Optional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  maxDownloadConnections?: number;
  /** 上传会话，默认 2，0 表示不限。 */
  @ApiPropertyOptional({
    type: 'integer',
    default: 2,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @Optional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  maxUploadSessions?: number;
  /** 分片并发，默认 4，0 表示不限。 */
  @ApiPropertyOptional({
    type: 'integer',
    default: 4,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @Optional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  maxChunkConcurrency?: number;
}
/** 实例创建输入。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class InstanceCreateDto {
  /** 展示名，1–100 字符。 */
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  name: string;
  /** http(s) 地址，可带子路径，禁止凭据、query 与 fragment。 */
  @ApiProperty({
    format: 'uri',
    description: 'http(s)，无 userinfo/query/fragment，允许子路径',
  })
  @IsString()
  baseUrl: string;
  /** 完整认证输入，必填。 */
  @ApiProperty({
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'secret'],
        properties: {
          mode: { type: 'string', enum: ['token'] },
          secret: {
            type: 'string',
            minLength: 1,
            writeOnly: true,
            format: 'password',
          },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'username', 'secret'],
        properties: {
          mode: { type: 'string', enum: ['password'] },
          username: { type: 'string', minLength: 1 },
          secret: {
            type: 'string',
            minLength: 1,
            writeOnly: true,
            format: 'password',
          },
        },
      },
    ],
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(
    /** 提供嵌套 DTO 的运行时类型。
     * @param 不适用。
     * @returns 字段的 DTO 构造器。
     * @throws 不适用。
     */
    () => AuthInputDto,
  )
  auth: AuthInputDto;
  /** 可省略的配额配置，未给字段使用默认值。 */
  @ApiPropertyOptional({ type: InstanceLimitsDto })
  @Optional()
  @IsObject()
  @ValidateNested()
  @Type(
    /** 提供嵌套 DTO 的运行时类型。
     * @param 不适用。
     * @returns 字段的 DTO 构造器。
     * @throws 不适用。
     */
    () => InstanceLimitsDto,
  )
  limits?: InstanceLimitsDto;
  /** 下载模式，默认 d。 */
  @ApiPropertyOptional({ enum: ['d', 'p'], default: 'd' })
  @Optional()
  @IsIn(['d', 'p'])
  downloadMode?: 'd' | 'p';
}
/** 实例补丁；至少一个字段，limits 合并，auth 整体替换。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class InstancePatchDto extends PartialType(InstanceCreateDto, {
  skipNullProperties: false,
}) {}
/** 实例分页查询。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class InstanceQueryDto {
  /** 页号，默认 1。 */
  @ApiPropertyOptional({
    type: 'integer',
    default: 1,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @Optional()
  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;
  /** 页大小，默认 50，最大 200。 */
  @ApiPropertyOptional({
    type: 'integer',
    default: 50,
    minimum: 1,
    maximum: 200,
  })
  @Optional()
  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 50;
  /** 是否包含归档记录，默认 false。 */
  @ApiPropertyOptional({ default: false })
  @Optional()
  @Transform(queryBoolean)
  @IsBoolean()
  includeArchived: boolean = false;
}
/** 连接测试输入。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class TestRequestDto {
  /** 显式人工重试，默认 false；429 冷却中仍返回 409。 */
  @ApiPropertyOptional({ default: false })
  @Optional()
  @IsBoolean()
  retryAuth: boolean = false;
}
/** 浏览请求；路径密码只在 body 中传递。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class BrowseRequestDto {
  /** 账号内绝对路径，最大 4096 UTF-8 字节，禁止 /@s 前缀。 */
  @ApiProperty({ description: '规范化账号路径，非法路径返回 INVALID_PATH' })
  @IsString()
  path: string;
  /** 可选路径密码，默认为空，不写入日志或 URL。 */
  @ApiPropertyOptional({ writeOnly: true, format: 'password' })
  @Optional()
  @IsString()
  password?: string;
  /** 是否刷新上游缓存，默认 false。 */
  @ApiPropertyOptional({ default: false })
  @Optional()
  @IsBoolean()
  refresh: boolean = false;
  /** 本地切分页号，默认 1。 */
  @ApiPropertyOptional({
    type: 'integer',
    default: 1,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @Optional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;
  /** 页大小，默认 50，最大 200。 */
  @ApiPropertyOptional({
    type: 'integer',
    default: 50,
    minimum: 1,
    maximum: 200,
  })
  @Optional()
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 50;
}
