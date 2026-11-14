import { exec } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * 语言包目录：`data/locales/*.json`。
 *
 * 不做上传接口 —— 这是本机应用，让用户直接把文件丢进目录最直接：
 * 不用处理 multipart、不用管临时文件，用户还能随时拿记事本改。
 * 程序只负责扫描、校验、把路径告诉他。
 */
export function localeDir() {
  const dir = resolve("data/locales");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** 单个语言包文件上限，防止误放的巨大文件把内存吃满 */
const MAX_BYTES = 1024 * 1024;

export interface LocalePackEntry {
  code: string;
  name: string;
  file: string;
  messages: Record<string, string>;
}

/**
 * 扫描目录里所有语言包。
 * 坏文件直接跳过而不是整体报错 —— 用户手写 JSON 少个逗号是常事，
 * 不该让整个语言列表跟着挂掉。
 */
export function listLocalePacks() {
  const dir = localeDir();
  const packs: LocalePackEntry[] = [];
  const skipped: { file: string; reason: string }[] = [];

  for (const file of readdirSync(dir)) {
    if (!file.toLowerCase().endsWith(".json")) continue;
    const full = join(dir, file);
    try {
      const raw = readFileSync(full, "utf8");
      if (raw.length > MAX_BYTES) {
        skipped.push({ file, reason: "文件超过 1MB" });
        continue;
      }
      const parsed = JSON.parse(raw) as {
        code?: unknown;
        name?: unknown;
        messages?: unknown;
      };
      const code = String(parsed.code ?? "").trim();
      const name = String(parsed.name ?? "").trim();
      if (!code || !name) {
        skipped.push({ file, reason: "缺少 code 或 name 字段" });
        continue;
      }
      if (!parsed.messages || typeof parsed.messages !== "object" || Array.isArray(parsed.messages)) {
        skipped.push({ file, reason: "缺少 messages 对象" });
        continue;
      }
      const messages: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed.messages as Record<string, unknown>)) {
        if (typeof value === "string" && value.trim()) messages[key] = value;
      }
      if (!Object.keys(messages).length) {
        skipped.push({ file, reason: "messages 里没有有效字符串" });
        continue;
      }
      packs.push({ code, name, file, messages });
    } catch (error) {
      skipped.push({ file, reason: error instanceof Error ? error.message : "无法解析" });
    }
  }

  return { dir, packs, skipped };
}

/** 在系统文件管理器里打开语言包目录 */
export function revealLocaleDir() {
  const dir = localeDir();
  const command =
    process.platform === "win32"
      ? `explorer.exe "${dir}"`
      : process.platform === "darwin"
        ? `open "${dir}"`
        : `xdg-open "${dir}"`;
  // explorer.exe 打开成功也会返回非 0，这里不看退出码
  exec(command, () => {});
  return dir;
}
