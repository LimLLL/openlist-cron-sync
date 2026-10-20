// 逐目录比较原名、过滤和冲突，只返回逻辑决策而不读写远程或数据库。
import type { JobFilter } from './filter.js';

/** 规划所需的最小列表条目，不含下载签名。 */
export interface Entry {
  /** 原名。 */
  name: string;
  /** 字节数；未知为 null。 */
  size: number | null;
  /** 是否目录。 */
  isDir: boolean;
  /** 源修改时间原文。 */
  modified: string | null;
}
/** 单个原名的比较结果。 */
export interface Decision {
  /** 相对路径。 */
  path: string;
  /** 原名。 */
  name: string;
  /** 源条目，可缺失。 */
  source?: Entry;
  /** 目标条目，可缺失。 */
  target?: Entry;
  /** 逻辑结果，directory 留给扫描编排递归。 */
  kind:
    | 'directory'
    | 'filtered'
    | 'protected'
    | 'new'
    | 'replace'
    | 'unchanged'
    | 'extra'
    | 'keep';
  /** 诊断码；正常过滤没有码。 */
  code?: string;
  /** 是否源内部问题，影响所有 Target。 */
  sourceIssue?: boolean;
  /** 仅目标单侧的非降级警告。 */
  warning?: boolean;
  /** 是否计入受管理目标文件 D。 */
  managed: boolean;
}
/** 计算简单名称碰撞键。
 * @param name JSON 原名。
 * @returns 非 locale 的 NFC 小写 NFC 键。
 * @throws 不适用。
 */
export function collisionKey(name: string): string {
  return name.normalize('NFC').toLowerCase().normalize('NFC');
}
/** 查找当前目录内部碰撞名。
 * @param entries 过滤前条目。
 * @returns 冲突原名集合。
 * @throws 不适用。
 */
export function collisions(entries: readonly Entry[]): Set<string> {
  const groups = new Map<string, Set<string>>();
  for (const entry of entries) {
    const key = collisionKey(entry.name);
    const names = groups.get(key) ?? new Set<string>();
    names.add(entry.name);
    groups.set(key, names);
  }
  const result = new Set<string>();
  for (const names of groups.values())
    if (names.size > 1) for (const name of names) result.add(name);
  return result;
}
/** 比较一个完整目录，碰撞检测先于过滤。
 * @param source 过滤前源条目。
 * @param target 过滤前目标条目。
 * @param relative 当前相对目录。
 * @param filter 已编译过滤规则。
 * @param mirror 是否计划 extras。
 * @param suspect 当前目录的局部可疑视图，不包括独立子目录；只禁止删除，不禁止新建。
 * @param sourceRoot 源目录是否为账号根目录；为 true 时 @s 开头的源条目按分享命名空间过滤。
 * @param targetRoot 目标目录是否为账号根目录；为 true 时 @s 开头的目标条目按分享命名空间过滤。
 * @returns 原列表顺序的决策，源在前、目标独有项在后。
 * @throws 不适用。
 */
export function compareDirectory(
  source: readonly Entry[],
  target: readonly Entry[],
  relative: string,
  filter: JobFilter,
  mirror: boolean,
  suspect: boolean,
  sourceRoot = false,
  targetRoot = false,
): Decision[] {
  const sources = new Map(
    source.map(
      /** 生成按原名索引源条目的映射项。
       * @param entry 源目录条目。
       * @returns 原名与条目的映射项。
       * @throws 不适用。
       */
      (entry) => [entry.name, entry],
    ),
  );
  const targets = new Map(
    target.map(
      /** 生成按原名索引目标条目的映射项。
       * @param entry 目标目录条目。
       * @returns 原名与条目的映射项。
       * @throws 不适用。
       */
      (entry) => [entry.name, entry],
    ),
  );
  const sourceCollisions = collisions(source);
  const allCollisions = collisions([...source, ...target]);
  const sourceKeys = new Set(
    source.map(
      /** 计算源条目的碰撞键。
       * @param entry 源目录条目。
       * @returns 该原名的碰撞键。
       * @throws 不适用。
       */
      (entry) => collisionKey(entry.name),
    ),
  );
  const result: Decision[] = [];
  for (const name of new Set([...sources.keys(), ...targets.keys()])) {
    const s = sources.get(name);
    const t = targets.get(name);
    const path = relative ? `${relative}/${name}` : name;
    const d: Decision = {
      path,
      name,
      source: s,
      target: t,
      kind: 'keep',
      managed: false,
    };
    if (allCollisions.has(name)) {
      Object.assign(d, {
        kind: 'protected',
        code: 'NAME_COLLISION',
        sourceIssue: sourceCollisions.has(name),
        warning: !sourceKeys.has(collisionKey(name)),
      });
    } else if (
      (sourceRoot && s && name.startsWith('@s')) ||
      (targetRoot && t && name.startsWith('@s'))
    ) {
      d.kind = 'filtered';
    } else if (
      (s &&
        (filter.excluded(path, s.isDir) ||
          (!s.isDir &&
            (!filter.filePath(path) ||
              (s.size !== null && !filter.size(s.size)))))) ||
      (t && filter.excluded(path, t.isDir))
    ) {
      d.kind = 'filtered';
    } else if (s && t && s.isDir !== t.isDir) {
      Object.assign(d, { kind: 'protected', code: 'TYPE_CONFLICT' });
    } else if (s?.isDir || t?.isDir) {
      d.kind = 'directory';
    } else if (!s && !filter.filePath(path)) {
      d.kind = 'filtered';
    } else if (s && s.size === null) {
      Object.assign(d, {
        kind: 'protected',
        code: 'UNKNOWN_SIZE',
        sourceIssue: true,
      });
    } else if (t && t.size === null) {
      Object.assign(d, {
        kind: 'protected',
        code: 'TARGET_UNKNOWN_SIZE',
        warning: !s,
      });
    } else if (suspect) {
      // 可疑视图可能漏列条目：只禁止替换与删除，已列出的源文件仍按 overwrite=false 新建，且不计入 D。
      d.kind =
        s && !t
          ? 'new'
          : s && t && s.size === t.size
            ? 'unchanged'
            : 'protected';
    } else if (s) {
      d.managed = t !== undefined;
      d.kind = !t ? 'new' : s.size === t.size ? 'unchanged' : 'replace';
    } else if (t && filter.size(t.size)) {
      d.managed = true;
      d.kind = mirror ? 'extra' : 'keep';
    } else d.kind = 'filtered';
    result.push(d);
  }
  return result;
}
