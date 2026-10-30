import { dirname, join } from "node:path";
import type { Store } from "./db.js";
import type { SmtpConfig } from "./mail.js";
import { decryptSecret, encryptSecret, isEncrypted } from "./secrets.js";

/**
 * SMTP 发件配置的读取与保存。
 *
 * 两处来源，优先级从高到低：
 *   1. 环境变量 SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / SMTP_FROM_NAME
 *      —— 授权码完全不进数据库，适合不想让凭据落在磁盘上的场景；
 *   2. 数据库 app_config 表的 smtp 项 —— 授权码以 AES-256-GCM 加密后存储，
 *      密钥在数据库同目录的 .mail-key 文件里。
 *
 * 无论哪种来源，接口都不会把授权码本身返回给前端，只返回 configured 布尔。
 */

export const SMTP_CONFIG_KEY = "smtp";

/** 前端可见的 SMTP 配置视图（不含授权码） */
export interface SmtpView {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  /** 是否已有可用的授权码 */
  configured: boolean;
  /** 是否由环境变量接管；为 true 时界面应改为只读 */
  managedByEnv: boolean;
}

/** 密钥文件与数据库放在同一目录，随 data/ 一起被 .gitignore 排除 */
function keyPathOf(store: Store): string | null {
  return store.dbPath === ":memory:" ? null : join(dirname(store.dbPath), ".mail-key");
}

/** 从环境变量读取 SMTP 配置；同时给出 SMTP_HOST 与 SMTP_USER 才算启用。 */
export function smtpFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  if (!host || !user) return null;

  const port = Number(env.SMTP_PORT) || 465;
  return {
    host,
    port,
    // 未显式指定时按「465 走 SSL，其余走 STARTTLS」推断
    secure: env.SMTP_SECURE ? env.SMTP_SECURE !== "false" : port === 465,
    user,
    pass: env.SMTP_PASS || "",
    fromName: env.SMTP_FROM_NAME?.trim() || "",
  };
}

/** 读取数据库里保存的配置，授权码在读取时解密。 */
export function readStoredSmtp(store: Store): SmtpConfig | null {
  const raw = store.getAppConfig(SMTP_CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SmtpConfig;
    return { ...parsed, pass: decryptSecret(parsed.pass || "", keyPathOf(store)) };
  } catch {
    return null;
  }
}

/** 真正用于发信的配置：环境变量优先，其次数据库。 */
export function resolveSmtp(store: Store): SmtpConfig | null {
  return smtpFromEnv() || readStoredSmtp(store);
}

/** 给前端看的视图：只暴露「有没有配授权码」，不返回授权码本身。 */
export function smtpView(store: Store): SmtpView {
  const env = smtpFromEnv();
  const config = env || readStoredSmtp(store);
  return {
    host: config?.host || "",
    port: config?.port || 465,
    secure: config?.secure ?? true,
    user: config?.user || "",
    fromName: config?.fromName || "",
    configured: !!config?.pass,
    managedByEnv: !!env,
  };
}

/**
 * 保存配置。授权码加密后入库；pass 留空表示沿用原值，clearPass 为 true 时清除。
 * 环境变量生效时仍允许保存（切回环境变量时以环境变量为准）。
 */
export function saveSmtp(
  store: Store,
  input: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    fromName?: string;
    pass?: string;
    clearPass?: boolean;
  },
): SmtpView {
  const existing = readStoredSmtp(store);

  let pass = existing?.pass || "";
  if (input.clearPass) pass = "";
  else if (input.pass) pass = input.pass;

  store.setAppConfig(
    SMTP_CONFIG_KEY,
    JSON.stringify({
      host: input.host,
      port: input.port,
      secure: input.secure,
      user: input.user,
      fromName: input.fromName || "",
      // 空值保持空字符串，避免出现无意义的密文
      pass: encryptSecret(pass, keyPathOf(store)),
    } satisfies SmtpConfig),
  );
  return smtpView(store);
}

/**
 * 启动时调用：把旧版本遗留的明文授权码就地升级为密文。
 * 已经是密文、没配置授权码、或配置读不出来时都不做任何改动。
 * @returns 是否真的做了升级（便于测试与日志）
 */
export function migrateSmtpSecret(store: Store): boolean {
  const raw = store.getAppConfig(SMTP_CONFIG_KEY);
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw) as SmtpConfig;
    // 没配授权码，或已经是密文，都无需处理
    if (!parsed.pass || isEncrypted(parsed.pass)) return false;

    saveSmtp(store, {
      host: parsed.host,
      port: parsed.port,
      secure: parsed.secure,
      user: parsed.user,
      fromName: parsed.fromName,
      pass: parsed.pass,
    });
    return true;
  } catch {
    return false;
  }
}
