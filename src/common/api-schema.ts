// 组装显式 OpenAPI 公共形状，绝不从数据库实体生成响应 schema。
import type { SchemaObject } from '@nestjs/swagger';

export const idSchema: SchemaObject = { type: 'string', format: 'uuid' };
export const timeSchema: SchemaObject = { type: 'string', format: 'date-time' };
export const sizeSchema: SchemaObject = {
  type: 'integer',
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
};
export const booleanSchema: SchemaObject = { type: 'boolean' };
export const stringSchema: SchemaObject = { type: 'string' };
/** 明确对象字段必填性和未知字段规则。
 * @param properties 公共字段。
 * @param required 必填字段，默认全部。
 * @returns 对象 schema。
 * @throws 不适用。
 */
export function objectSchema(
  properties: Record<string, SchemaObject>,
  required = Object.keys(properties),
): SchemaObject {
  return { type: 'object', additionalProperties: false, properties, required };
}
/** 构造数组形状。
 * @param items 项形状。
 * @returns 数组 schema。
 * @throws 不适用。
 */
export function arraySchema(items: SchemaObject): SchemaObject {
  return { type: 'array', items };
}
/** 显式允许 null，保留字段必填性。
 * @param schema 字段形状。
 * @returns 可空形状。
 * @throws 不适用。
 */
export function nullable(schema: SchemaObject): SchemaObject {
  return { ...schema, nullable: true };
}
/** 构造标准分页响应。
 * @param item 公共项形状。
 * @returns Page schema。
 * @throws 不适用。
 */
export function pageSchema(item: SchemaObject): SchemaObject {
  return objectSchema({
    items: arraySchema(item),
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 200 },
    total: sizeSchema,
  });
}
