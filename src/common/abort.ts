// 只识别当前信号引起的中止，关闭期间也不吞掉数据库或实现错误。
/** 判断异常是否属于指定已中止信号。
 * @param error 捕获的异常。
 * @param signal 当前生命周期信号。
 * @returns 是否可作为正常停止处理。
 * @throws 不适用。
 */
export function aborted(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted &&
    (error === signal.reason ||
      (error instanceof Error && error.name === 'AbortError'))
  );
}
