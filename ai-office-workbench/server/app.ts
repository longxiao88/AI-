import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { z } from "zod";
import {
  documentInputSchema,
  documentResultSchema,
  meetingInputSchema,
  meetingResultSchema,
  parseModelJson,
  projectInputSchema,
  projectResultSchema,
} from "../shared/ai-schemas.js";
import { chatInputSchema, type ChatMessage } from "../shared/chat.js";
import { searchKnowledge } from "../shared/knowledge.js";
import type { Mode } from "../shared/types.js";
import { ApiError, chatPrompt, complete, knowledgePrompt } from "./ai.js";
import { installAuth } from "./auth.js";
import type { Store } from "./db.js";
import { officePrompts } from "./office-prompts.js";

const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

const text = z.string().max(50000);
const mode = z.enum(["compose", "polish", "summary"]);
const kinds = z.enum(["writing", "meetings", "projects", "documents", "knowledge"]);

const entrySchema = z
  .object({
    title: z.string().trim().min(1, "请填写标题").max(120),
    data: z
      .object({
        input: text.optional(),
        output: text.optional(),
        mode: mode.optional(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .or(z.literal(""))
          .optional(),
        source: text.optional(),
        summary: text.optional(),
        todos: text.optional(),
        notes: text.optional(),
        description: text.optional(),
        keywords: z.string().max(500).optional(),
      })
      .strict(),
  })
  .strict();

const taskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    status: z.enum(["todo", "doing", "done"]),
  })
  .strict();

const settingsSchema = z
  .object({
    baseUrl: z.string().url().max(500),
    model: z.string().trim().min(1).max(120),
    key: z.string().trim().max(2048).optional(),
    clearKey: z.boolean().optional(),
  })
  .strict();

const taskBatchSchema = z
  .object({
    requestId: z.string().trim().min(1).max(100),
    tasks: z
      .array(z.object({ title: z.string().trim().min(1).max(200) }).strict())
      .min(1)
      .max(20),
  })
  .strict();

interface AppOptions {
  fetcher?: typeof fetch;
  timeout?: number;
  staticDir?: string;
}

export function createApp(store: Store, options: AppOptions = {}) {
  const app = express();

  // API Key 只放在进程内存里，不写数据库，重启后需要重新填写。
  let key = "";
  // 同一时间只处理一个 AI 请求，处理期间也不允许修改连接设置。
  let busy = false;

  app.disable("x-powered-by");

  // 本应用只在本机运行：拒绝非本机 Host（防 DNS rebinding）和跨站写请求。
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!LOCAL_HOSTS.includes(req.hostname))
      return res.status(403).json({ error: "仅允许本机访问。" });
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

    const origin = req.get("origin");
    if (origin && !isLocalOrigin(origin))
      return res.status(403).json({ error: "不允许跨站请求。" });
    if (req.get("sec-fetch-site") === "cross-site")
      return res.status(403).json({ error: "不允许跨站请求。" });
    if (!req.is("application/json")) return res.status(415).json({ error: "请求必须使用 JSON。" });
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  const settings = () => ({
    ...(store.getSettings() || { baseUrl: "https://api.openai.com/v1", model: "" }),
    hasKey: !!key,
  });

  async function callModel(
    input: string,
    mode: Mode,
    systemPrompt?: string,
    conversation?: ChatMessage[],
  ) {
    if (busy) throw new ApiError(409, "已有 AI 请求正在处理，请勿重复提交。");
    const conf = settings();
    if (!conf.model) throw new ApiError(409, "请先在设置中填写模型名称。");
    busy = true;
    try {
      return await complete(
        { ...conf, key },
        input,
        mode,
        options.fetcher,
        options.timeout,
        systemPrompt,
        conversation,
      );
    } finally {
      busy = false;
    }
  }

  // 会议、项目、文档三个模块要求模型返回 JSON，格式不对直接报 502，不做猜测修补。
  async function callModelForJson<T>(payload: object, prompt: string, schema: z.ZodType<T>) {
    const raw = await callModel(JSON.stringify(payload), "summary", prompt);
    try {
      return parseModelJson(raw, schema);
    } catch (e) {
      throw new ApiError(502, e instanceof Error ? e.message : "AI 返回格式无效，请稍后重试。");
    }
  }

  app.get("/api/health", (_req, res) => res.json({ ok: true, mode: "local" }));

  installAuth(app, store);

  // ---- 操作日志 ----

  app.get("/api/history", (_req, res) => res.json(store.history()));

  app.post("/api/history/:id/restore", (req, res) => {
    try {
      res.json(store.restore(String(req.params.id)));
    } catch (e) {
      throw new ApiError(409, e instanceof Error ? e.message : "回溯失败。");
    }
  });

  // ---- 设置 ----

  app.get("/api/settings", (_req, res) => res.json(settings()));

  app.put("/api/settings", (req, res) => {
    const value = settingsSchema.parse(req.body);
    if (!isAllowedBaseUrl(value.baseUrl))
      throw new ApiError(
        400,
        "API 地址需使用 HTTPS（本机服务可用 HTTP），且不包含账号、参数或片段。",
      );
    if (busy) throw new ApiError(409, "请等待当前 AI 请求结束后再修改设置。");

    store.setSettings(value.baseUrl.replace(/\/+$/, ""), value.model);
    if (value.clearKey) key = "";
    else if (value.key) key = value.key;
    res.json(settings());
  });

  app.delete("/api/settings/key", (_req, res) => {
    if (busy) throw new ApiError(409, "请等待当前 AI 请求结束。");
    key = "";
    res.json(settings());
  });

  // ---- AI ----

  app.post("/api/ai/test", async (_req, res) => {
    await callModel("请仅回复：连接成功", "compose");
    res.json({ ok: true });
  });

  app.post("/api/ai/generate", async (req, res) => {
    const { input, mode: writingMode } = z
      .object({ input: z.string().trim().min(1).max(20000), mode })
      .strict()
      .parse(req.body);
    const output = await callModel(input, writingMode);
    res.json({ output });
  });

  app.post("/api/ai/knowledge", async (req, res) => {
    const { question } = z
      .object({ question: z.string().trim().min(1).max(500) })
      .strict()
      .parse(req.body);
    const sources = searchKnowledge(store.list("knowledge"), question);
    if (!sources.length)
      throw new ApiError(404, "知识库未找到相关资料，请先补充内容或更换关键词。");

    const input = JSON.stringify({
      question,
      sources: sources.map((s, i) => ({ number: i + 1, title: s.title, content: s.excerpt })),
    });
    const answer = await callModel(input, "summary", knowledgePrompt);
    res.json({ answer, sources });
  });

  app.post("/api/ai/meetings", async (req, res) => {
    const { title, source } = meetingInputSchema.parse(req.body);
    res.json(await callModelForJson({ title, source }, officePrompts.meeting, meetingResultSchema));
  });

  app.post("/api/ai/projects", async (req, res) => {
    const { title, description } = projectInputSchema.parse(req.body);
    const result = await callModelForJson(
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
      await callModelForJson({ title, source }, officePrompts.document, documentResultSchema),
    );
  });

  // 独立问答：多轮对话由前端带上，不读知识库、不写数据库
  app.post("/api/ai/chat", async (req, res) => {
    const { messages } = chatInputSchema.parse(req.body);
    const answer = await callModel("", "compose", chatPrompt, messages);
    if (answer.length > 20000) throw new ApiError(502, "AI 回答过长，请缩小问题范围后重试。");
    res.json({ answer });
  });

  // ---- 知识库检索 ----

  app.get("/api/knowledge/search", (req, res) => {
    const q = z.string().trim().min(1).max(500).parse(req.query.q);
    res.json(searchKnowledge(store.list("knowledge"), q));
  });

  // ---- 记录（写作 / 会议 / 项目 / 文档 / 知识库） ----

  const findEntry = (id: string) => {
    const item = store.get(id);
    if (!item) throw new ApiError(404, "记录不存在或已删除。");
    return item;
  };

  app.get("/api/entries", (req, res) => {
    const kind = req.query.kind ? kinds.parse(req.query.kind) : undefined;
    res.json(store.list(kind));
  });

  app.get("/api/entries/:id", (req, res) => {
    res.json(findEntry(String(req.params.id)));
  });

  app.post("/api/entries/:kind", (req, res) => {
    const kind = kinds.parse(req.params.kind);
    const { title, data } = entrySchema.parse(req.body);
    res.status(201).json(store.save(kind, title, data));
  });

  app.put("/api/entries/:id", (req, res) => {
    const item = findEntry(String(req.params.id));
    const { title, data } = entrySchema.parse(req.body);
    res.json(store.save(item.kind, title, data, item.id));
  });

  app.delete("/api/entries/:id", (req, res) => {
    store.remove(String(req.params.id));
    res.json({ ok: true });
  });

  // ---- 项目任务 ----

  app.use("/api/projects/:projectId/tasks", (req, _res, next) => {
    if (store.get(String(req.params.projectId))?.kind !== "projects")
      throw new ApiError(404, "项目不存在。");
    next();
  });

  app.get("/api/projects/:projectId/tasks", (req, res) => {
    res.json(store.tasks(String(req.params.projectId)));
  });

  app.post("/api/projects/:projectId/tasks", (req, res) => {
    const { title, status } = taskSchema.parse(req.body);
    res.status(201).json(store.saveTask(String(req.params.projectId), title, status));
  });

  app.post("/api/projects/:projectId/tasks/batch", (req, res) => {
    const { requestId, tasks } = taskBatchSchema.parse(req.body);
    try {
      const result = store.addTasksBatch(
        String(req.params.projectId),
        tasks.map((t) => t.title),
        requestId,
      );
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (e) {
      throw new ApiError(409, e instanceof Error ? e.message : "批量加入任务失败，请重试。");
    }
  });

  app.put("/api/projects/:projectId/tasks/:id", (req, res) => {
    const projectId = String(req.params.projectId);
    const id = String(req.params.id);
    const { title, status } = taskSchema.parse(req.body);
    if (!store.tasks(projectId).some((t) => t.id === id)) throw new ApiError(404, "任务不存在。");
    res.json(store.saveTask(projectId, title, status, id));
  });

  app.delete("/api/projects/:projectId/tasks/:id", (req, res) => {
    store.removeTask(String(req.params.projectId), String(req.params.id));
    res.json({ ok: true });
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在。" }));

  // 生产模式下由同一个进程提供前端页面
  const staticDir = options.staticDir || resolve("dist");
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get("/{*path}", (_req, res) => res.sendFile(resolve(staticDir, "index.html")));
  }

  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (err instanceof z.ZodError)
        return res.status(400).json({ error: "输入格式不正确，请检查必填内容及字数限制。" });
      if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
      if (err instanceof SyntaxError) return res.status(400).json({ error: "请求格式不正确。" });
      if ((err as { type?: string })?.type === "entity.too.large")
        return res.status(413).json({ error: "提交的内容过大。" });
      res.status(500).json({ error: "保存或处理失败，请重试。" });
    },
  );

  return app;
}

function isLocalOrigin(origin: string) {
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

// 只允许 HTTPS；本机调试用的模型服务可以走 HTTP。
function isAllowedBaseUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) return false;

  return (
    url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname))
  );
}
