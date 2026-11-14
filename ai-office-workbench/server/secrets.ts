import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { dirname } from "node:path";

/**
 * 敏感配置的加密存储。
 *
 * 用途：SMTP 授权码这类必须能还原成明文才能用的凭据，直接写进 SQLite 是明文，
 * 数据库文件一旦被复制走就等于泄露。这里用 AES-256-GCM 加密后再入库，
 * 密钥单独放在数据库同目录的密钥文件里（权限 0600），两者不在一起就没有意义。
 *
 * 注意：这是「数据库文件与密钥文件分离」级别的保护，不是对抗本机攻击者。
 * 真正的敏感凭据建议改用环境变量，见 server/smtp.ts 的 smtpFromEnv。
 */

/** 密文前缀：用于识别已加密的值，也便于将来更换算法版本 */
const PREFIX = "enc:v1:";

/** 密钥文件只读一次，之后走内存缓存 */
const keyCache = new Map<string, Buffer>();

/** 数据库在内存里（测试场景）时用的临时密钥，不落盘 */
let ephemeralKey: Buffer | null = null;

/** 判断一个值是否已经是本模块产出的密文 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

function readKeyFile(keyPath: string): Buffer {
  const cached = keyCache.get(keyPath);
  if (cached) return cached;

  if (existsSync(keyPath)) {
    const key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "hex");
    if (key.length !== 32)
      throw new Error(`密钥文件已损坏：${keyPath}（应包含 64 位十六进制字符）`);
    keyCache.set(keyPath, key);
    return key;
  }

  // 首次使用：生成 32 字节随机密钥并落盘，尽量收紧权限
  const key = randomBytes(32);
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, key.toString("hex"), { mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // Windows 上 chmod 语义有限，失败不影响功能
  }
  keyCache.set(keyPath, key);
  return key;
}

function resolveKey(keyPath: string | null): Buffer {
  if (keyPath) return readKeyFile(keyPath);
  ephemeralKey ??= randomBytes(32);
  return ephemeralKey;
}

/**
 * 加密一个明文值。空值原样返回，已是密文的原样返回（幂等）。
 * 输出格式：enc:v1:<iv>:<authTag>:<密文>，三段均为十六进制。
 */
export function encryptSecret(plain: string, keyPath: string | null): string {
  if (!plain) return "";
  if (isEncrypted(plain)) return plain;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", resolveKey(keyPath), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${data.toString("hex")}`;
}

/**
 * 解密一个值。
 * 遇到旧版本留下的明文时原样返回（保证升级后仍能发信），
 * 下一次保存配置时会自动改写成密文。
 */
export function decryptSecret(stored: string, keyPath: string | null): string {
  if (!stored) return "";
  if (!isEncrypted(stored)) return stored;

  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("密文格式不正确，无法解密。");

  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv("aes-256-gcm", resolveKey(keyPath), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/** 测试辅助：清空密钥缓存，让下一次读取重新从文件加载 */
export function resetKeyCache() {
  keyCache.clear();
  ephemeralKey = null;
}
