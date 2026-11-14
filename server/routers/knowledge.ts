import type { Express } from "express";
import { z } from "zod";
import { searchKnowledge } from "../../shared/knowledge.js";
import { ApiError } from "../ai.js";
import type { AppContext } from "../context.js";
import { extOf, parseToText } from "../files.js";

/** 知识库：关键词检索与文件解析（解析不落盘，只取正文） */
export function installKnowledgeRoutes(app: Express, ctx: AppContext) {
  app.get("/api/knowledge/search", (req, res) => {
    const q = z.string().trim().min(1).max(500).parse(req.query.q);
    res.json(searchKnowledge(ctx.store.list(ctx.accountOf(req), "knowledge"), q));
  });

  // 知识库导入：把上传的 Word / Excel / 文本文件解析为纯文本，不落盘、只取正文。
  app.post("/api/knowledge/parse", ctx.upload.single("file"), async (req, res) => {
    ctx.accountOf(req);
    if (!req.file) throw new ApiError(400, "请选择要解析的文件。");
    const originalName = req.file.originalname || "未命名";
    const ext = extOf(originalName);
    if (!/\.(docx|xlsx|txt|md|markdown|csv|tsv|json|log)$/i.test(ext))
      throw new ApiError(400, "暂不支持该文件类型，请改用 .docx / .xlsx 或文本文件。");
    try {
      const text = await parseToText(req.file.buffer, ext);
      res.json({
        title: originalName.replace(/\.[^.]+$/, ""),
        text: text.replace(/\r\n/g, "\n"),
      });
    } catch {
      throw new ApiError(400, "无法解析该文件，请确认文件未损坏或格式正确。");
    }
  });
}
