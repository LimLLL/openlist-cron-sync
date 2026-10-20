// 实现相对路径 glob 和包含边界的大小过滤，不访问文件系统。
import picomatch from 'picomatch';
import type { Filters } from '../jobs/job-types.js';

/** 一次 Run 编译的固定过滤器。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class JobFilter {
  private readonly includes: ((path: string) => boolean)[];
  private readonly excludes: {
    directoryOnly: boolean;
    matches: (path: string) => boolean;
  }[];
  /** 编译已验证的模式。
   * @param filters 完整配置。
   * @returns 不适用。
   * @throws Error picomatch 编译失败。
   */
  constructor(private readonly filters: Filters) {
    this.includes = filters.include.map(
      /** 编译一个大小写敏感的 include 模式。
       * @param pattern 已验证的 include glob。
       * @returns 相对路径匹配函数。
       * @throws Error picomatch 编译失败。
       */
      (pattern) =>
        picomatch(pattern, {
          dot: true,
          nonegate: true,
          nocase: false,
          windows: false,
        }),
    );
    this.excludes = filters.exclude.map(
      /** 编译一个 exclude 模式；尾部斜杠表示仅匹配目录。
       * @param pattern 已验证的 exclude glob。
       * @returns 仅目录标记与去掉尾部斜杠后的匹配函数。
       * @throws Error picomatch 编译失败。
       */
      (pattern) => ({
        directoryOnly: pattern.endsWith('/'),
        matches: picomatch(
          pattern.endsWith('/') ? pattern.slice(0, -1) : pattern,
          { dot: true, nonegate: true, nocase: false, windows: false },
        ),
      }),
    );
  }
  /** 判断文件或目录是否被路径排除。
   * @param path 无前导斜杠的相对路径。
   * @param directory 是否目录。
   * @returns 是否剪枝或过滤。
   * @throws 不适用。
   */
  excluded(path: string, directory: boolean): boolean {
    return this.excludes.some(
      /** 检查单条 exclude 规则是否命中该路径。
       * @param rule 已编译的 exclude 规则。
       * @returns 规则适用于此条目类型且路径匹配时为 true。
       * @throws 不适用。
       */
      (rule) => (!rule.directoryOnly || directory) && rule.matches(path),
    );
  }
  /** 判断文件路径是否属于 include 集合，exclude 优先。
   * @param path 相对文件路径。
   * @returns 是否纳入文件过滤。
   * @throws 不适用。
   */
  filePath(path: string): boolean {
    return (
      !this.excluded(path, false) &&
      (this.includes.length === 0 ||
        this.includes.some(
          /** 检查单个 include 模式是否匹配该文件路径。
           * @param match 已编译的 include 匹配函数。
           * @returns 是否匹配。
           * @throws 不适用。
           */
          (match) => match(path),
        ))
    );
  }
  /** 判断已知大小；未知大小不通过传输规划。
   * @param size 字节数或 null。
   * @returns 是否通过大小范围。
   * @throws 不适用。
   */
  size(size: number | null): boolean {
    return (
      size !== null &&
      (this.filters.minSizeBytes === null ||
        size >= this.filters.minSizeBytes) &&
      (this.filters.maxSizeBytes === null || size <= this.filters.maxSizeBytes)
    );
  }
}
