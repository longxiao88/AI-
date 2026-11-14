/**
 * 发信冷却与配额。
 *
 * 验证码邮件是一次「真实支出」：每发一封都会消耗邮箱服务商的配额，
 * 而且成本落在部署者自己的邮箱上。所以除了防止暴力刷接口，
 * 还要挡住「同一个账号反复点发送」把配额刷光。
 *
 * 规则：
 *   1. 冷却：同一个 key 两次发送之间至少间隔 cooldownMs（默认 60 秒）；
 *   2. 配额：一个窗口（默认 1 小时）内最多 maxPerWindow 次（默认 10 次）。
 *
 * key 由调用方拼装。找回密码用「IP + 输入的账号标识」，绑定邮箱用
 * 「IP + 账号 ID + 目标邮箱」。**不存在的账号也走同一套 key**，
 * 这样 429 不会变成探测「账号是否存在」的信号。
 *
 * 记录只放内存，随进程重启清空——和登录失败计数保持一致的做法；
 * 它防的是高频刷取，不是跨重启的累计记账。
 */
export interface CooldownResult {
  ok: boolean;
  /** 还需要等待的秒数；ok 为 true 时是 0 */
  retryAfter: number;
}

export interface CooldownOptions {
  cooldownMs?: number;
  windowMs?: number;
  maxPerWindow?: number;
}

const DEFAULT_COOLDOWN = 60 * 1000;
const DEFAULT_WINDOW = 60 * 60 * 1000;
const DEFAULT_MAX = 10;

export class SendCooldown {
  private readonly cooldownMs: number;
  private readonly windowMs: number;
  private readonly maxPerWindow: number;
  private readonly sent = new Map<string, number[]>();

  constructor(options: CooldownOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW;
    this.maxPerWindow = options.maxPerWindow ?? DEFAULT_MAX;
  }

  /**
   * 尝试占用一次发送名额。返回 ok:false 时不占用、不改变已有记录。
   * @param now 便于测试注入时间
   */
  take(key: string, now: number = Date.now()): CooldownResult {
    const recent = (this.sent.get(key) ?? []).filter((t) => now - t < this.windowMs);

    const last = recent[recent.length - 1];
    if (last !== undefined) {
      const elapsed = now - last;
      if (elapsed < this.cooldownMs) {
        this.sent.set(key, recent);
        return {
          ok: false,
          retryAfter: Math.max(1, Math.ceil((this.cooldownMs - elapsed) / 1000)),
        };
      }
    }

    if (recent.length >= this.maxPerWindow) {
      this.sent.set(key, recent);
      // 窗口内配额用尽：等到最早那次滑出窗口
      const oldest = recent[0];
      return {
        ok: false,
        retryAfter: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
      };
    }

    recent.push(now);
    this.sent.set(key, recent);
    return { ok: true, retryAfter: 0 };
  }

  /** 清空记录；传 key 只清一条（测试与登出等场景用） */
  clear(key?: string) {
    if (key === undefined) this.sent.clear();
    else this.sent.delete(key);
  }

  /** 当前跟踪的 key 数量，便于观测内存占用 */
  get size() {
    return this.sent.size;
  }
}
