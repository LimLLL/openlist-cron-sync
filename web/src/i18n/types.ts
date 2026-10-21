// 翻译资源的结构约束：中文必须与英文键完全一致，值可为任意字符串。

/** 把英文命名空间映射为同键、值为 string 的形状，缺键或多键都会编译失败。
 * @template T 英文命名空间资源类型（as const 字面量）。
 */
export type Translation<T> = {
  [K in keyof T]: T[K] extends string ? string : Translation<T[K]>;
};
