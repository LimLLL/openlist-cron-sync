// 定义管理认证的公共请求和响应，不暴露存储实体。
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, ValidateBy } from 'class-validator';
import { validPassword } from '../configuration/validation.js';

/** 密码验证装饰器。
 * @param 不适用。
 * @returns 密码属性装饰器。
 * @throws 不适用。
 */
function Password(): PropertyDecorator {
  return ValidateBy({
    name: 'passwordBounds',
    validator: {
      /** 校验未知输入的类型及密码边界。
       * @param value 原始值。
       * @returns 是否有效。
       * @throws 不适用。
       */
      validate(value: unknown): boolean {
        return typeof value === 'string' && validPassword(value);
      },
    },
  });
}

/** 登录请求。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class LoginDto {
  /** 必填用户名，1–64 字符，不接受 null。 */
  @ApiProperty({ minLength: 1, maxLength: 64 })
  @IsString()
  @Length(1, 64)
  username: string;

  /** 必填密码，12–128 字符且 UTF-8 不超过 512 字节。 */
  @ApiProperty({
    minLength: 12,
    maxLength: 128,
    format: 'password',
    writeOnly: true,
    description: 'UTF-8 最大 512 字节；不接受 null',
  })
  @Password()
  password: string;
}

/** 改密请求。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class ChangePasswordDto {
  /** 当前密码，12–128 字符，UTF-8 最大 512 字节，必填。 */
  @ApiProperty({
    minLength: 12,
    maxLength: 128,
    format: 'password',
    writeOnly: true,
    description: 'UTF-8 最大 512 字节；不接受 null',
  })
  @Password()
  currentPassword: string;

  /** 新密码，12–128 字符，UTF-8 最大 512 字节，必填。 */
  @ApiProperty({
    minLength: 12,
    maxLength: 128,
    format: 'password',
    writeOnly: true,
    description: 'UTF-8 最大 512 字节；不接受 null',
  })
  @Password()
  newPassword: string;
}

/** 管理员公开视图。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class AdminView {
  /** 唯一管理员 ID，固定为 1。 */
  @ApiProperty({ enum: [1] })
  id: number;
  /** 用户名。 */
  @ApiProperty({ minLength: 1, maxLength: 64 })
  username: string;
  /** 是否必须先改密。 */
  @ApiProperty()
  mustChangePassword: boolean;
}

/** 登录响应，token 只在此接口返回且禁止写日志。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class LoginView {
  /** 新签发的管理 JWT。 */
  @ApiProperty()
  accessToken: string;
  /** 固定认证类型。 */
  @ApiProperty({ enum: ['Bearer'] })
  tokenType: 'Bearer';
  /** 有效期秒数，由 ADMIN_JWT_TTL_SECONDS 决定。 */
  @ApiProperty({ minimum: 300, maximum: 86400, type: 'integer' })
  expiresIn: number;
  /** 是否必须先改密。 */
  @ApiProperty()
  mustChangePassword: boolean;
}
