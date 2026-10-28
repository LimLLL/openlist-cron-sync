// 仅在本次扫描内保存重试路径树；每个输入的扫描结果由PlanWriter批量落库。
import type { RunRetryItemRecord } from '../database/run-schema.js';

/** 一个相对路径节点，祖先仅用于到达选中项。 */
export interface ScopeNode {
  /** 此路径自身的各目标输入。 */
  items: Map<string, RunRetryItemRecord>;
  /** 原名到下一级节点。 */
  children: Map<string, ScopeNode>;
  /** 自身或后代涉及的RunTarget ID。 */
  targets: Set<string>;
}
/** 创建一个尚未包含输入的节点。
 * @returns 空范围节点。
 * @throws 不适用。
 */
function node(): ScopeNode {
  return { items: new Map(), children: new Map(), targets: new Set() };
}
/** 具体重试范围树，不保存目录内容或跨Run状态。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class ScanScope {
  private readonly paths = new Map<string, ScopeNode>();
  /** 从新Run持久化输入构造祖先链。
   * @param items 本轮范围项。
   * @returns 不适用。
   * @throws Error 范围重复或相对路径非法。
   */
  constructor(items: RunRetryItemRecord[]) {
    if (!items.length) throw new Error('Retry scope is empty');
    const root = node();
    this.paths.set('', root);
    for (const item of items) {
      let current = root;
      current.targets.add(item.runTargetId);
      let path = '';
      for (const name of item.relativePath === ''
        ? []
        : item.relativePath.split('/')) {
        if (!name || name === '.' || name === '..')
          throw new Error('Invalid retry relative path');
        path = path ? `${path}/${name}` : name;
        let child = current.children.get(name);
        if (!child) {
          child = node();
          current.children.set(name, child);
          this.paths.set(path, child);
        }
        current = child;
        current.targets.add(item.runTargetId);
      }
      if (current.items.has(item.runTargetId))
        throw new Error('Duplicate retry input');
      current.items.set(item.runTargetId, item);
    }
  }
  /** 读取范围节点；不在任何祖先链中的路径返回undefined。
   * @param relative 相对路径。
   * @returns 范围节点。
   * @throws 不适用。
   */
  get(relative: string): ScopeNode | undefined {
    return this.paths.get(relative);
  }
  /** 判断路径是否属于一个目标的必要遍历范围。
   * @param relative 相对路径。
   * @param targetId 可选RunTarget ID；省略判断源并集。
   * @returns 是否需要处理此节点。
   * @throws 不适用。
   */
  has(relative: string, targetId?: string): boolean {
    const current = this.get(relative);
    return (
      current !== undefined &&
      (targetId === undefined || current.targets.has(targetId))
    );
  }
  /** 遍历一个范围内尚未处理的输入，不将祖先虚构成输入项。
   * @param relative 子树根。
   * @param targetId 可选目标过滤。
   * @param descendants 是否包含后代。
   * @returns 尚未处理项的迭代器。
   * @throws 不适用。
   */
  *pending(
    relative: string,
    targetId?: string,
    descendants = true,
  ): Generator<RunRetryItemRecord> {
    const current = this.get(relative);
    if (!current) return;
    for (const item of current.items.values())
      if (
        item.scanOutcome === 'unprocessed' &&
        (targetId === undefined || targetId === item.runTargetId)
      )
        yield item;
    if (descendants)
      for (const name of current.children.keys())
        yield* this.pending(relative ? `${relative}/${name}` : name, targetId);
  }
  /** 正常扫描结束必须覆盖全部输入，遗漏不能伪装成成功。
   * @returns 不适用。
   * @throws Error 尚有未处理输入。
   */
  assertComplete(): void {
    if (!this.pending('').next().done)
      throw new Error('Retry scan left unprocessed inputs');
  }
}
