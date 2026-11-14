import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 资源库的文件存储与解析。
 * 文件本体存到磁盘（默认 data/files/），entries 表只存文件元信息。
 * Word（.docx）用 mammoth 转 HTML / 纯文本，Excel（.xlsx）用 xlsx 转表格。
 */

export interface StoredFile {
  /** 磁盘上的唯一文件名（含扩展名），如 "a1b2c3.docx" */
  storedName: string;
  /** 完整绝对路径 */
  path: string;
}

export const FILE_EXT = /\.(docx|xlsx|txt|md|markdown|csv|pdf|pptx|png|jpg|jpeg|gif)$/i;

/** 压缩包上传：解压成多条资源时的上限，防止一次塞进过多文件或解压炸弹 */
const ZIP_MAX_FILES = 50;
const ZIP_MAX_BYTES = 200 * 1024 * 1024;

export interface ExtractedFile {
  /** 压缩包内的文件名（已去掉目录路径） */
  name: string;
  buffer: Buffer;
}

export interface ExtractResult {
  files: ExtractedFile[];
  /** 被跳过的条目数：目录、隐藏文件、macOS 资源分支、不支持的格式、超出上限 */
  skipped: number;
  /** 是否因为文件数或体积达到上限而提前停止 */
  truncated: boolean;
}

/**
 * 把 zip 解压成可入库的文件列表。
 * 只保留 FILE_EXT 支持的格式；目录、隐藏文件与 __MACOSX 一律跳过。
 * 不写入磁盘——由调用方决定每个文件落在哪。
 */
export async function extractZip(buffer: Buffer): Promise<ExtractResult> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const files: ExtractedFile[] = [];
  let skipped = 0;
  let total = 0;
  let truncated = false;

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;

    const name = path.split("/").pop() || "";
    if (!name || name.startsWith(".") || path.includes("__MACOSX") || !FILE_EXT.test(extOf(name))) {
      skipped += 1;
      continue;
    }
    if (files.length >= ZIP_MAX_FILES || total >= ZIP_MAX_BYTES) {
      truncated = true;
      skipped += 1;
      continue;
    }

    const data = await entry.async("nodebuffer");
    total += data.length;
    files.push({ name, buffer: data });
  }

  return { files, skipped, truncated };
}

const MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".zip": "application/zip",
};

export function mimeFor(ext: string): string {
  return MIME[ext.toLowerCase()] || "application/octet-stream";
}

/** 允许在线预览文本内容的扩展名（docx/xlsx 解析为文本，其余纯文本直接读） */
const PREVIEWABLE = /\.(docx|xlsx|txt|md|markdown|csv)$/i;

export function isPreviewable(ext: string): boolean {
  return PREVIEWABLE.test(ext);
}

/**
 * 把文件内容解析为纯文本（不落盘，直接吃 Buffer）。
 * docx 用 mammoth 抽纯文本，xlsx 用 xlsx 转 CSV，其余按 UTF-8 文本读取。
 * 供资源库与知识库共用：资源库存文件后解析，知识库只取正文、不存文件本体。
 */
export async function parseToText(buffer: Buffer, ext: string): Promise<string> {
  const lower = ext.toLowerCase();
  if (lower === ".docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  if (lower === ".xlsx") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buffer, { type: "buffer" });
    return wb.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
      return `【${name}】\n${csv}`;
    }).join("\n\n");
  }
  // txt / md / csv 等纯文本：按 UTF-8 读取，非 UTF-8 视为乱码直接抛错
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}

export function fileStore(dir = resolve("data/files")) {
  mkdirSync(dir, { recursive: true });

  /** 把上传的 Buffer 落盘，返回唯一存储文件名 */
  function write(buffer: Buffer, originalName: string): StoredFile {
    const ext = extname(originalName).toLowerCase();
    const storedName = `${randomUUID()}${ext}`;
    const path = join(dir, storedName);
    writeFileSync(path, buffer);
    return { storedName, path };
  }

  function read(storedName: string): Buffer {
    return readFileSync(join(dir, storedName));
  }

  function remove(storedName: string) {
    const path = join(dir, storedName);
    if (existsSync(path)) rmSync(path);
  }

  function stream(storedName: string) {
    return createReadStream(join(dir, storedName));
  }

  /** 把文件内容解析为纯文本，供 AI 分析与文本预览使用 */
  async function toText(storedName: string, ext: string): Promise<string> {
    return parseToText(read(storedName), ext);
  }

  /** 把 Word 解析为 HTML，供前端富文本预览 */
  async function docxToHtml(storedName: string): Promise<string> {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.convertToHtml({ buffer: read(storedName) });
    return value;
  }

  /** 把 Excel 解析为多工作表二维数组，供前端表格预览 */
  async function xlsxToSheets(storedName: string): Promise<{ name: string; rows: string[][] }[]> {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(read(storedName), { type: "buffer" });
    return wb.SheetNames.map((name) => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
        header: 1,
        raw: false,
        defval: "",
      }) as string[][];
      return { name, rows };
    });
  }

  return { dir, write, read, remove, stream, toText, docxToHtml, xlsxToSheets };
}

export type FileStore = ReturnType<typeof fileStore>;

/** 取文件名的扩展名（含点、小写），如 "report.docx" → ".docx" */
export function extOf(name: string): string {
  return extname(name).toLowerCase();
}
