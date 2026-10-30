import type { Express } from "express";
import { z } from "zod";
import {
  documentInputSchema,
  documentResultSchema,
  meetingInputSchema,
  meetingResultSchema,
  mindmapResultSchema,
  projectInputSchema,
  projectResultSchema,
} from "../../shared/ai-schemas.js";
import { chatInputSchema } from "../../shared/chat.js";
import { searchKnowledge } from "../../shared/knowledge.js";
import { ApiError, knowledgePrompt, chatPrompt } from "../ai.js";
import type { AppContext } from "../context.js";
import { officePrompts } from "../office-prompts.js";
import { mode } from "../schemas.js";

/** 八个 AI 入口：连接测试、写作、知识库问答、会议、项目、文档、导图、自由问答 */
export function installAiRoutes(app: Express, ctx: AppContext) {
  app.post("/api/ai/test", async (req, res) => {
    await ctx.callModel(ctx.accountOf(req), "请仅回复：连接成功", "compose");
    res.json({ ok: true });
  });

  app.post("/api/ai/generate", async (req, res) => {
    const { input, mode: writingMode } = z
      .object({ input: z.string().trim().min(1).max(20000), mode })
      .strict()
      .parse(req.body);
    const output = await ctx.callModel(ctx.accountOf(req), input, writingMode);
    res.json({ output });
  });

  app.post("/api/ai/knowledge", async (req, res) => {
    const accountId = ctx.accountOf(req);
    const { question } = z
      .object({ question: z.string().trim().min(1).max(500) })
      .strict()
      .parse(req.body);
    const sources = searchKnowledge(ctx.store.list(accountId, "knowledge"), question);
    if (!sources.length)
      throw new ApiError(404, "知识库未找到相关资料，请先补充内容或更换关键词。");

    const input = JSON.stringify({
      question,
      sources: sources.map((s, i) => ({ number: i + 1, title: s.title, content: s.excerpt })),
    });
    const answer = await ctx.callModel(accountId, input, "summary", knowledgePrompt);
    res.json({ answer, sources });
  });

  app.post("/api/ai/meetings", async (req, res) => {
    const { title, source } = meetingInputSchema.parse(req.body);
    res.json(
      await ctx.callModelForJson(
        ctx.accountOf(req),
        { title, source },
        officePrompts.meeting,
        meetingResultSchema,
      ),
    );
  });

  app.post("/api/ai/projects", async (req, res) => {
    const { title, description } = projectInputSchema.parse(req.body);
    const result = await ctx.callModelForJson(
      ctx.accountOf(req),
      { title, description },
      officePrompts.project,
      projectResultSchema,
    );
    // 模型偶尔会给出同名任务，这里去掉完全重复的标题
    const seen = new Set<string>();
    const tasks = result.tasks.filter((t) => {
      if (seen.has(t.title)) return false;
      seen.add(t.title);
      return true;
    });
    res.json({ tasks });
  });

  app.post("/api/ai/documents", async (req, res) => {
    const { title, source } = documentInputSchema.parse(req.body);
    res.json(
      await ctx.callModelForJson(
        ctx.accountOf(req),
        { title, source },
        officePrompts.document,
        documentResultSchema,
      ),
    );
  });

  app.post("/api/ai/mindmap", async (req, res) => {
    const { title, source } = documentInputSchema.parse(req.body);
    res.json(
      await ctx.callModelForJson(
        ctx.accountOf(req),
        { title, source },
        officePrompts.mindmap,
        mindmapResultSchema,
      ),
    );
  });

  // 独立问答：多轮对话由前端带上，不读知识库、不写数据库
  app.post("/api/ai/chat", async (req, res) => {
    const { messages } = chatInputSchema.parse(req.body);
    const answer = await ctx.callModel(ctx.accountOf(req), "", "compose", chatPrompt, messages);
    if (answer.length > 20000) throw new ApiError(502, "AI 回答过长，请缩小问题范围后重试。");
    res.json({ answer });
  });
}
