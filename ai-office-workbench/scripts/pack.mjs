#!/usr/bin/env node
/**
 * 打包一份「可以分享给别人」的源码包：自动排除依赖、构建产物、本地数据与编辑器配置。
 *
 * 用法：
 *   node scripts/pack.mjs              # 生成到 dist-share/<项目名>-<版本>.zip
 *   node scripts/pack.mjs out.zip      # 指定输出路径
 *
 * 为什么不用系统 zip / Compress-Archive：
 *   Windows 自带工具会写中文文件名时出现乱码，且不方便精确控制排除规则。
 *   这里用 Node 自己写 zip，跨平台行为一致。
 */
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat, rm } from "node:fs/promises";
import { join, relative, sep, dirname, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";

const ROOT = resolve(import.meta.dirname, "..");

/** 完全排除的目录名（任意层级命中即跳过） */
const EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-preview",
  "data",
  "test-results",
  ".git",
  ".idea",
  ".vscode",
  ".workbuddy",
  "coverage",
  ".cache",
]);

/** 排除的文件名 */
const EXCLUDE_FILES = new Set([
  ".env",
  ".env.local",
  ".mail-key",
  "Thumbs.db",
  ".DS_Store",
]);

/** 排除的扩展名与通配 */
const EXCLUDE_EXT = new Set([
  ".log",
  ".tsbuildinfo",
  ".sqlite",
  ".sqlite-shm",
  ".sqlite-wal",
  ".mail-key",
]);

/**
 * 敏感内容扫描。
 *
 * 打包前把每个文本文件过一遍：命中阻断级规则就整体中止（否则一旦发出去就收不回来），
 * 命中提示级只告警，由人判断是不是测试数据。
 */
const SENSITIVE_BLOCKERS = [
  {
    name: "SMTP 授权码明文",
    re: /\bSMTP_PASS\s*[:=]\s*["'`]?([^\s"'`,;]+)/g,
    // 值里这些词说明是占位或测试数据
    placeholder: /(fake|mock|test|example|dummy|sample|placeholder|changeme|xxx|密码|授权码)/i,
  },
  { name: "AES 密文（enc:v1:）", re: /enc:v1:[0-9a-fA-F]{16,}/g },
  { name: "私钥内容", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    name: "疑似 API Key",
    re: /\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,
  },
  { name: "带口令的连接串", re: /\b(postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s"'@/]+:[^\s"'@/]+@/g },
];

const SENSITIVE_WARNINGS = [
  {
    name: "真实邮箱地址",
    re: /\b[A-Za-z0-9._%+-]+@(?:qq|163|126|sina|sohu|gmail|outlook|hotmail|foxmail)\.[a-z]{2,}\b/gi,
    // 测试与文档里常用的占位前缀，命中这些就不提示
    allow: /^(?:example|test|someone|alice|bob|user|you|admin|demo|legacy|changed|sender|foo|bar|me)@/i,
  },
];

/** 含这些扩展名的文件按二进制处理，跳过文本扫描 */
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp",
  ".woff", ".woff2", ".ttf", ".otf", ".zip", ".pdf", ".mp4", ".webm",
]);

/** 单文件扫描上限：超过 512KB 的文本不太可能是配置文件，跳过以免拖慢 */
const MAX_SCAN_BYTES = 512 * 1024;

/** 注释行里的示例写法不算泄露 */
const isCommentLine = (line) => {
  const t = line.trimStart();
  return t.startsWith("#") || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
};

/** 命中内容是否像"真的密钥"：中文说明、占位词、太短的一律放过 */
function looksReal(hit, rule) {
  if (/[\u4e00-\u9fa5]/.test(hit)) return false;
  if (rule.placeholder?.test(hit)) return false;
  const value = hit.replace(/\s/g, "");
  return value.length >= 8;
}

async function scanSensitive(files) {
  const blockers = [];
  const warnings = [];
  let scanned = 0;

  for (const file of files) {
    const name = relative(ROOT, file).split(sep).join("/");
    const dot = name.lastIndexOf(".");
    if (dot > 0 && BINARY_EXT.has(name.slice(dot).toLowerCase())) continue;

    const s = await stat(file);
    if (s.size > MAX_SCAN_BYTES) continue;

    const text = await readFile(file, "utf8").catch(() => null);
    if (text === null) continue;
    scanned++;

    const lines = text.split(/\r?\n/);
    // 测试用例本来就会写假的密钥来验证逻辑，命中只提示不阻断
    const softOnly = name.startsWith("tests/");

    for (const rule of SENSITIVE_BLOCKERS) {
      let found = null;
      for (const line of lines) {
        if (isCommentLine(line)) continue;
        for (const m of line.matchAll(rule.re)) {
          if (looksReal(m[0], rule)) {
            found = m[0].slice(0, 60);
            break;
          }
        }
        if (found) break;
      }
      if (!found) continue;
      if (softOnly) warnings.push({ file: name, rule: `${rule.name}（测试数据）`, hit: found });
      else blockers.push({ file: name, rule: rule.name });
    }

    for (const rule of SENSITIVE_WARNINGS) {
      for (const match of text.matchAll(rule.re)) {
        const hit = match[0];
        if (rule.allow?.test(hit)) continue;
        warnings.push({ file: name, rule: rule.name, hit });
        break;
      }
    }
  }

  return { blockers, warnings, scanned };
}

function shouldSkip(name, isDir) {
  if (isDir) return EXCLUDE_DIRS.has(name);
  if (EXCLUDE_FILES.has(name)) return true;
  if (name.endsWith(".mail-key")) return true;
  if (name.startsWith(".env.") && name !== ".env.example" && name !== ".env.preview") return true;
  const dot = name.lastIndexOf(".");
  if (dot > 0 && EXCLUDE_EXT.has(name.slice(dot))) return true;
  return false;
}

async function collect(dir, list = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (shouldSkip(entry.name, entry.isDirectory())) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, list);
    else list.push(full);
  }
  return list;
}

/** 读取仓库根 .gitignore，把顶层条目也一并排除，避免两处规则不一致 */
async function readGitignoreDirs() {
  try {
    const text = await readFile(join(ROOT, ".gitignore"), "utf8");
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
      .map((l) => l.replace(/\/$/, ""))
      .filter((l) => !l.includes("*") && !l.includes("/"));
  } catch {
    return [];
  }
}

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

async function main() {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  // 用本地日期而不是 toISOString（UTC），否则东八区凌晨打包会写成前一天
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const baseName = `${pkg.name}-${pkg.version}`;
  const outPath = resolve(process.argv[2] || join(ROOT, "dist-share", `${baseName}-源码-${stamp}.zip`));

  const extra = await readGitignoreDirs();
  for (const d of extra) EXCLUDE_DIRS.add(d);

  const files = await collect(ROOT);
  files.sort((a, b) => relative(ROOT, a).localeCompare(relative(ROOT, b), "zh"));

  if (!files.length) {
    console.error("没有可打包的文件，已中止。");
    process.exit(1);
  }

  // 打包前先过一遍敏感内容：命中阻断级直接中止，绝不生成压缩包
  const { blockers, warnings, scanned } = await scanSensitive(files);
  if (blockers.length) {
    console.error("\n发现敏感内容，已中止打包（不会生成压缩包）：");
    for (const b of blockers) console.error(`  × ${b.file} —— ${b.rule}`);
    console.error("\n请先删掉这些内容，或把它们移进已被忽略的文件里，再重新运行。\n");
    process.exit(1);
  }

  await mkdir(dirname(outPath), { recursive: true });
  await rm(outPath, { force: true });

  const ws = createWriteStream(outPath);
  const chunks = [];
  const central = [];
  let offset = 0;

  const push = (buf) => {
    chunks.push(buf);
    offset += buf.length;
  };

  for (const file of files) {
    const name = relative(ROOT, file).split(sep).join("/");
    const data = await readFile(file);
    const s = await stat(file);
    const { time, date } = dosTime(s.mtime);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名标志，避免中文乱码
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    push(local);
    push(nameBuf);
    push(payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset - payload.length - nameBuf.length - 30, 42);
    central.push(Buffer.concat([cd, nameBuf]));
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  const total = Buffer.concat([...chunks, centralBuf, end]);
  ws.write(total);
  const done = new Promise((r) => ws.end(r));
  await done;

  const sizeMB = (total.length / 1024 / 1024).toFixed(2);
  console.log(`已生成：${outPath}`);
  console.log(`文件数：${files.length}`);
  console.log(`压缩后：${sizeMB} MB`);
  console.log(`已排除：${[...EXCLUDE_DIRS].join(", ")}、.env、*.mail-key、*.sqlite*`);

  console.log(`\n敏感扫描：已检查 ${scanned} 个文本文件`);
  console.log("  ✔ 未发现授权码明文、私钥、AES 密文或 API Key");
  if (warnings.length) {
    console.log(`  ⚠ ${warnings.length} 处需要人工确认（多半是测试数据）：`);
    for (const w of warnings) console.log(`      ${w.file}｜${w.rule}｜${w.hit}`);
  } else {
    console.log("  ✔ 未发现真实邮箱或其他可疑内容");
  }
}

await main();
