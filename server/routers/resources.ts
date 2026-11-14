import type { Express } from "express";
import { documentResultSchema } from "../../shared/ai-schemas.js";
import { ApiError } from "../ai.js";
import type { AppContext } from "../context.js";
import { extOf, extractZip, FILE_EXT, isPreviewable, mimeFor } from "../files.js";
import { officePrompts } from "../office-prompts.js";

/** 资源库：上传 / 下载 / 在线预览 / AI 分析 / 提取正文。文件本体在磁盘，entries 里只存元信息。 */
export function installResourceRoutes(app: Express, ctx: AppContext) {
  // 能提取正文的格式：与 files.parseToText 的支持范围一致（PDF、图片不在其中）
  const TEXT_EXTRACTABLE = /\.(docx|xlsx|txt|md|markdown|csv|tsv|json|log)$/i;

  // 上传一个文件，落盘后返回资源记录（kind=resources）。
  // .zip 会自动解压成多条资源，压缩包本身不留存。
  app.post("/api/resources/upload", ctx.upload.single("file"), async (req, res) => {
    const accountId = ctx.accountOf(req);
    if (!req.file) throw new ApiError(400, "请选择要上传的文件。");
    const originalName = req.file.originalname || "未命名";
    const ext = extOf(originalName);
    const category = req.body.category?.trim() || "未分类";
    const title = req.body.title?.trim() || originalName.replace(/\.[^.]+$/, "");

    // 压缩包：原件也存一条（随时可下载），再按文件逐个入库
    if (ext === ".zip") {
      let result: Awaited<ReturnType<typeof extractZip>>;
      try {
        result = await extractZip(req.file.buffer);
      } catch {
        throw new ApiError(400, "无法读取该压缩包，请确认文件未损坏或改用标准 zip 格式。");
      }

      const storedZip = ctx.files.write(req.file.buffer, originalName);
      const zipEntry = ctx.store.save(accountId, "resources", title.slice(0, 120), {
        filename: originalName,
        storedName: storedZip.storedName,
        ext: ".zip",
        size: req.file.size,
        category,
        downloads: 0,
        notes: "",
      });

      // 一个可用文件都没有时不报错：原件已经存下，如实告诉用户「解压出 0 个」
      if (!result.files.length) {
        return res.status(201).json({
          entries: [zipEntry],
          zipId: zipEntry.id,
          extracted: 0,
          skipped: result.skipped,
          truncated: result.truncated,
        });
      }

      const entries = result.files.map((file) =>
        ctx.store.save(accountId, "resources", file.name.replace(/\.[^.]+$/, "").slice(0, 120), {
          filename: file.name,
          storedName: ctx.files.write(file.buffer, file.name).storedName,
          ext: extOf(file.name),
          size: file.buffer.length,
          category,
          downloads: 0,
          notes: "",
        }),
      );
      return res.status(201).json({
        entries: [zipEntry, ...entries],
        zipId: zipEntry.id,
        extracted: entries.length,
        skipped: result.skipped,
        truncated: result.truncated,
      });
    }

    if (!FILE_EXT.test(ext)) throw new ApiError(400, "暂不支持该文件类型。");

    const stored = ctx.files.write(req.file.buffer, originalName);
    const entry = ctx.store.save(accountId, "resources", title.slice(0, 120), {
      filename: originalName,
      storedName: stored.storedName,
      ext,
      size: req.file.size,
      category,
      downloads: 0,
      notes: "",
    });
    res.status(201).json(entry);
  });

  // 下载文件：计数 +1 后以原始文件名流式返回
  app.get("/api/resources/:id/download", (req, res) => {
    const accountId = ctx.accountOf(req);
    const item = ctx.store.get(accountId, String(req.params.id));
    if (!item || item.kind !== "resources") throw new ApiError(404, "资源不存在或已删除。");
    const { filename, storedName, ext } = item.data;
    if (!storedName || !filename) throw new ApiError(404, "资源文件缺失。");
    // 下载计数 +1（轻量更新，不记操作日志）
    ctx.store.bumpDownloads(accountId, item.id);
    res.setHeader("Content-Type", mimeFor(ext || ""));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    ctx.files.stream(storedName).pipe(res);
  });

  // 提取正文：供知识库、文档分析「从资源库选」时取文本，只读不落盘、不改资源本身
  app.get("/api/resources/:id/text", async (req, res) => {
    const item = ctx.store.get(ctx.accountOf(req), String(req.params.id));
    if (!item || item.kind !== "resources") throw new ApiError(404, "资源不存在或已删除。");
    const { storedName, ext, filename } = item.data;
    if (!storedName) throw new ApiError(404, "资源文件缺失。");
    // PDF 与图片没有可用的解析器，提前给出明确提示，而不是落到「解析失败」
    if (!TEXT_EXTRACTABLE.test(ext || ""))
      throw new ApiError(400, "该格式不支持提取正文，请下载后用其他方式查看。");

    let text: string;
    try {
      text = await ctx.files.toText(storedName, ext || "");
    } catch {
      throw new ApiError(500, "文件解析失败，可能是文件损坏或格式不受支持。");
    }
    if (!text.trim()) throw new ApiError(400, "未能从该文件中提取到文本内容。");

    res.json({
      title: item.title,
      filename: filename || item.title,
      text: text.replace(/\r\n/g, "\n"),
    });
  });

  // 在线预览：docx→HTML、xlsx→表格、纯文本→文本
  app.get("/api/resources/:id/preview", async (req, res) => {
    const item = ctx.store.get(ctx.accountOf(req), String(req.params.id));
    if (!item || item.kind !== "resources") throw new ApiError(404, "资源不存在或已删除。");
    const { storedName, ext } = item.data;
    if (!storedName) throw new ApiError(404, "资源文件缺失。");
    const lower = (ext || "").toLowerCase();
    if (!isPreviewable(lower))
      throw new ApiError(400, "该类型暂不支持在线预览，请下载后查看。");

    try {
      if (lower === ".docx") {
        res.json({ type: "html", html: await ctx.files.docxToHtml(storedName) });
      } else if (lower === ".xlsx") {
        res.json({ type: "sheets", sheets: await ctx.files.xlsxToSheets(storedName) });
      } else {
        res.json({ type: "text", text: await ctx.files.toText(storedName, lower) });
      }
    } catch {
      throw new ApiError(500, "文件解析失败，可能是文件损坏或格式不受支持。");
    }
  });

  // AI 分析：抽取文本后复用文档分析提示词，返回概述 / 要点 / 建议
  app.post("/api/resources/:id/analyze", async (req, res) => {
    const accountId = ctx.accountOf(req);
    const item = ctx.store.get(accountId, String(req.params.id));
    if (!item || item.kind !== "resources") throw new ApiError(404, "资源不存在或已删除。");
    const { storedName, ext } = item.data;
    if (!storedName) throw new ApiError(404, "资源文件缺失。");

    let source: string;
    try {
      source = await ctx.files.toText(storedName, ext || "");
    } catch {
      throw new ApiError(500, "文件解析失败，可能是文件损坏或格式不受支持。");
    }
    if (!source.trim()) throw new ApiError(400, "未能从文件中提取到文本内容。");
    if (source.length > 20000) source = source.slice(0, 20000);

    const result = await ctx.callModelForJson(
      accountId,
      { title: item.title, source },
      officePrompts.document,
      documentResultSchema,
    );
    res.json(result);
  });
}
