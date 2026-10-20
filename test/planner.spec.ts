// 验证纯过滤、碰撞、diff 与阈值的产品行为矩阵。
import { JobFilter } from '../src/sync/filter.js';
import { compareDirectory, collisionKey } from '../src/sync/planner.js';
import type { Entry } from '../src/sync/planner.js';
import { deletionSafety } from '../src/sync/safety.js';
import { addStat, emptyStats } from '../src/sync/stats.js';

/** 构造纯规划条目。
 * @param name 原名。
 * @param size 大小。
 * @param isDir 是否目录。
 * @returns 无框架依赖的条目。
 * @throws 不适用。
 */
function entry(name = 'a', size: number | null = 1, isDir = false): Entry {
  return { name, size, isDir, modified: null };
}
const filter = new JobFilter({
  include: [],
  exclude: [],
  minSizeBytes: null,
  maxSizeBytes: null,
});

/** 覆盖纯规划层：逐项比较、过滤语义、名称碰撞与删除阈值，不依赖 Nest 或 F1。
 * @param 不适用。
 * @returns 不适用。
 * @throws Error 断言失败。
 */
describe('M2 pure planning', () => {
  /** 在镜像与增量模式下逐项比较单个源/目标条目的分类，增量模式下多余文件改为 keep。
   * @param source 源侧条目，undefined 表示源不存在。
   * @param target 目标侧条目，undefined 表示目标不存在。
   * @param kind 镜像模式下的预期分类。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it.each([
    [entry(), undefined, 'new'],
    [entry(), entry(), 'unchanged'],
    [entry(), entry('a', 2), 'replace'],
    [entry(), entry('a', null), 'protected'],
    [entry('a', null), undefined, 'protected'],
    [entry('a', 0), undefined, 'new'],
    [entry('a', 0, true), entry(), 'protected'],
    [entry('a', 0, true), undefined, 'directory'],
    [undefined, entry(), 'extra'],
    [undefined, entry('a', null), 'protected'],
  ] as const)(
    'compares source %j and target %j as %s',
    (source, target, kind) => {
      for (const mirror of [true, false]) {
        const result = compareDirectory(
          source ? [source] : [],
          target ? [target] : [],
          '',
          filter,
          mirror,
          false,
        )[0];
        expect(result.kind).toBe(kind === 'extra' && !mirror ? 'keep' : kind);
      }
    },
  );
  it.each([
    ['cache/', 'cache', true, true],
    ['cache/', 'x/cache', true, false],
    ['cache/', 'cache', false, false],
    ['**/cache/', 'x/cache', true, true],
    ['**/tmp', 'x/tmp', true, true],
    ['**/tmp', 'tmp', false, true],
    ['*.log', 'x/a.log', false, false],
    ['*.log', 'a.log', true, true],
    ['**/*.log', '.x/a.log', false, true],
  ])(
    'implements exclude %s for %s',
    /** 按相对路径 glob 匹配排除模式：尾部斜杠仅匹配目录，无双星前缀时从根锚定，点路径同样匹配。
     * @param pattern 排除模式。
     * @param path 相对路径。
     * @param isDir 路径是否为目录。
     * @param expected 是否应被排除。
     * @returns 不适用。
     * @throws Error 断言失败。
     */
    (pattern, path, isDir, expected) => {
      const f = new JobFilter({
        include: [],
        exclude: [pattern],
        minSizeBytes: null,
        maxSizeBytes: null,
      });
      expect(f.excluded(path, isDir)).toBe(expected);
    },
  );
  /** 源侧过滤结果决定同名目标文件是否受管理，增量模式的多余文件仍计入 D 并保留。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('keeps source filtering authoritative for matching target files and counts incremental extras in D', () => {
    const f = new JobFilter({
      include: ['**/*.jpg'],
      exclude: [],
      minSizeBytes: 10,
      maxSizeBytes: 20,
    });
    const values = compareDirectory(
      [entry('a.jpg', 10), entry('b.jpg', 9)],
      [entry('a.jpg', 50), entry('b.jpg', 15), entry('c.jpg', 12)],
      '',
      f,
      false,
      false,
    );
    expect(
      values.map(
        /** 提取比较结果的分类和受管理标志。
         * @param v 比较决策。
         * @returns [kind, managed] 二元组。
         * @throws 不适用。
         */
        (v) => [v.kind, v.managed],
      ),
    ).toEqual([
      ['replace', true],
      ['filtered', false],
      ['keep', true],
    ]);
    expect(f.excluded('directory', true)).toBe(false);
    expect(f.size(20)).toBe(true);
    expect(f.size(21)).toBe(false);
  });
  /** 在过滤前按 NFC 与大小写检测名称碰撞，并区分源侧阻断、跨侧保护和目标侧警告。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('detects pre-filter NFC/case collisions and distinguishes target-only warnings', () => {
    const f = new JobFilter({
      include: ['only'],
      exclude: [],
      minSizeBytes: null,
      maxSizeBytes: null,
    });
    expect(collisionKey('E\u0301')).toBe(collisionKey('é'));
    const source = compareDirectory(
      [entry('A'), entry('a')],
      [],
      '',
      f,
      true,
      false,
    );
    expect(
      source.every(
        /** 检查源侧碰撞条目被标记为源问题且码为 NAME_COLLISION。
         * @param v 比较决策。
         * @returns 是否为源侧名称碰撞。
         * @throws 不适用。
         */
        (v) => v.sourceIssue && v.code === 'NAME_COLLISION',
      ),
    ).toBe(true);
    const cross = compareDirectory(
      [entry('a')],
      [entry('A')],
      '',
      filter,
      true,
      false,
    );
    expect(
      cross.every(
        /** 检查仅大小写不同的跨侧同名条目无警告且受保护。
         * @param v 比较决策。
         * @returns 是否为无警告的 protected 决策。
         * @throws 不适用。
         */
        (v) => !v.warning && v.kind === 'protected',
      ),
    ).toBe(true);
    const target = compareDirectory(
      [],
      [entry('A'), entry('a')],
      '',
      filter,
      true,
      false,
    );
    expect(
      target.every(
        /** 检查目标侧碰撞仅产生警告且不纳入管理。
         * @param v 比较决策。
         * @returns 是否为未管理的警告条目。
         * @throws 不适用。
         */
        (v) => v.warning && !v.managed,
      ),
    ).toBe(true);
  });
  it.each([
    [10, 3, 2, null],
    [10, 3, 3, 'DELETE_LIMIT'],
    [0, 0, 0, null],
    [0, 1, 0, 'DELETE_BLOCKED'],
  ] as const)(
    'checks D=%i replace=%i extra=%i',
    /** 按受管理目标文件数 D 与删除候选数判断阈值，恰好用满预算允许、超出预算为 DELETE_LIMIT、候选数超过 D 为 DELETE_BLOCKED。
     * @param d 受管理目标文件数 D。
     * @param r 替换候选数。
     * @param e 多余文件候选数。
     * @param code 预期跳过码，null 表示允许。
     * @returns 不适用。
     * @throws Error 断言失败。
     */
    (d, r, e, code) => {
      expect(
        deletionSafety(
          d,
          r,
          e,
          { enabled: true, maxCount: 100, maxPercent: 50 },
          false,
          false,
        ).code,
      ).toBe(code);
    },
  );
  /** 确认覆盖不能绕过扫描阻断或 R>D 的无效计划，预算与统计使用精确整数运算。
   * @param 不适用。
   * @returns 不适用。
   * @throws Error 断言失败。
   */
  it('does not let overrides bypass blocks or invalid plans, and uses exact integer arithmetic', () => {
    const limits = { enabled: false, maxCount: null, maxPercent: null };
    expect(deletionSafety(10, 1, 0, limits, true, true)).toEqual({
      budget: 0,
      code: 'DELETE_BLOCKED',
      invalidPlan: false,
    });
    expect(deletionSafety(0, 1, 0, limits, true, false).invalidPlan).toBe(true);
    expect(
      deletionSafety(
        Number.MAX_SAFE_INTEGER,
        0,
        0,
        { enabled: true, maxCount: null, maxPercent: 50 },
        false,
        false,
      ).budget,
    ).toBe(4503599627370495);
    const stats = emptyStats();
    addStat(stats, 'plannedBytes', Number.MAX_SAFE_INTEGER);
    expect(
      /** 在已达安全整数上限的统计上继续累加。
       * @param 不适用。
       * @returns 不适用。
       * @throws Error 预期抛出 RESOURCE_LIMIT。
       */
      () => addStat(stats, 'plannedBytes'),
    ).toThrow('RESOURCE_LIMIT');
  });
});
