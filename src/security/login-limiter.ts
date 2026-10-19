// 提供只记录真实失败的进程内登录窗口和无队列 scrypt 名额。
import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../configuration/app-config.js';
import { ApiError } from '../common/errors.js';

/** 固定失败窗口；expiresAt 为毫秒截止时间，failures 为已完成的失败数。 */
interface FailureWindow {
  /** 首次失败加窗口长度。 */
  expiresAt: number;
  /** 真实凭据失败计数。 */
  failures: number;
}

/** 登录限流；没有后台定时器或持久化状态。
 * @param 不适用。
 * @returns 不适用。
 * @throws 不适用。
 */
@Injectable()
export class LoginLimiter {
  private readonly ips = new Map<string, FailureWindow>();
  private readonly usernames = new Map<string, FailureWindow>();
  private active = 0;
  private nextPruneAt = 0;

  /** 保存窗口配置。
   * @param config 应用配置。
   * @returns 不适用。
   * @throws 不适用。
   */
  constructor(@Inject(AppConfig) private readonly config: AppConfig) {}

  /** 在任何 scrypt 操作前检查两个窗口并取得一个名额。
   * @param ip 已按可信代理策略解析的客户端 IP。
   * @param username 请求的用户名。
   * @returns 不适用。
   * @throws ApiError 窗口或容量限流，均不创建计数。
   */
  enter(ip: string, username: string): void {
    const now = Date.now();
    this.prune(now);
    let blockedUntil = 0;
    for (const entry of [this.ips.get(ip), this.usernames.get(username)]) {
      if (
        entry &&
        entry.expiresAt > now &&
        entry.failures >= this.config.loginMaxFailures
      )
        blockedUntil = Math.max(blockedUntil, entry.expiresAt);
    }
    if (blockedUntil > now)
      throw new ApiError(
        429,
        'LOGIN_RATE_LIMITED',
        'Too many authentication attempts',
        [],
        Math.ceil((blockedUntil - now) / 1000),
      );
    if (this.active >= 2)
      throw new ApiError(
        429,
        'LOGIN_RATE_LIMITED',
        'Authentication capacity is busy',
        [],
        1,
      );
    this.active += 1;
  }

  /** 释放调用方持有的名额，必须置于 finally。
   * @param 不适用。
   * @returns 不适用。
   * @throws 不适用。
   */
  leave(): void {
    this.active -= 1;
  }

  /** 仅在密码或账号真实不匹配时创建、增加计数。
   * @param ip 客户端 IP。
   * @param username 已验证格式的用户名。
   * @returns 不适用。
   * @throws 不适用。
   */
  failure(ip: string, username: string): void {
    const now = Date.now();
    this.prune(now);
    this.increment(this.ips, ip, now);
    this.increment(this.usernames, username, now);
  }

  /** 登录成功只清除用户名计数。
   * @param username 管理员用户名。
   * @returns 不适用。
   * @throws 不适用。
   */
  success(username: string): void {
    this.usernames.delete(username);
  }

  /** 更新一个固定窗口，不延长已经存在的窗口。
   * @param entries 计数表。
   * @param key IP 或用户名。
   * @param now 当前毫秒时间。
   * @returns 不适用。
   * @throws 不适用。
   */
  private increment(
    entries: Map<string, FailureWindow>,
    key: string,
    now: number,
  ): void {
    const existing = entries.get(key);
    if (existing && existing.expiresAt > now) existing.failures += 1;
    else
      entries.set(key, {
        failures: 1,
        expiresAt: now + this.config.loginWindowSeconds * 1000,
      });
  }

  /** 有认证流量时最多每秒扫描一次；空闲时不增长，无需清理定时器。
   * @param now 当前毫秒时间。
   * @returns 不适用。
   * @throws 不适用。
   */
  private prune(now: number): void {
    if (now < this.nextPruneAt) return;
    for (const entries of [this.ips, this.usernames]) {
      for (const [key, window] of entries)
        if (window.expiresAt <= now) entries.delete(key);
    }
    this.nextPruneAt = now + 1000;
  }
}
