// 表达relay本地失败与远端未知结果，不含上游秘密。
/** relay失败证据；最终Operation由Sync分类和持久化。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
export class RelayError extends Error {
  /** 保存明确原因及可重试性。
   * @param code 固定原因码。
   * @param message 受控摘要。
   * @param retryable 是否允许重新准备源或新session。
   * @param unknown 是否缺少可靠结束证据。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(
    readonly code: string,
    message = code,
    readonly retryable = false,
    readonly unknown = false,
  ) {
    super(message);
  }
}
