import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { parseModelJson } from "../shared/ai-schemas.js";
import type { ChatMessage } from "../shared/chat.js";
import type { Mode, Settings } from "../shared/types.js";
import { ApiError, complete } from "./ai.js";
import { installAuth } from "./auth.js";
import type { AppContext, AppOptions } from "./context.js";
import type { Store } from "./db.js";
import { fileStore } from "./files.js";
import { UPLOAD } from "../shared/constants.js";
import { isLocalOrigin, LOCAL_HOSTS } from "./hosts.js";
import { installAiRoutes } from "./routers/ai.js";
import { installEntryRoutes } from "./routers/entries.js";
import { installHistoryRoutes } from "./routers/history.js";
import { installKnowledgeRoutes } from "./routers/knowledge.js";
import { installResourceRoutes } from "./routers/resources.js";
import { installSettingsRoutes } from "./routers/settings.js";
import { installTaskRoutes } from "./routers/tasks.js";
import { migrateSmtpSecret } from "./smtp.js";

export type { AppOptions } from "./context.js";

/**
 * 组装应用：安全中间件 → 鉴权 → 各领域路由 → 404 → 静态页面 → 错误兜底。
 * 具体路由按领域拆在 ./routers/ 下，这里只负责装配顺序。
 */
export function createApp(store: Store, options: AppOptions = {}) {
  const app = express();

  // API Key 只放在进程内存里，不写数据库，重启后需要重新填写。
  let key = "";
  // 同一时间只处理一个 AI 请求，处理期间也不允许修改连接设置。
  let busy = false;
  // 资源库文件存储（默认 data/files/）
  const files = fileStore(options.filesDir);
  // multer 内存接收上传，随后写入文件存储
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: UPLOAD.maxBytes },
    // 浏览器直接以 UTF-8 字节发送文件名，busboy 默认按 latin1 解码会乱码，这里显式声明
    defParamCharset: "utf8",
  });

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
    // 文件上传 / 解析走 multipart/form-data，其余写请求要求 JSON
    if (req.path.startsWith("/resources/upload") || req.path.startsWith("/knowledge/parse"))
      return next();
    if (!req.is("application/json")) return res.status(415).json({ error: "请求必须使用 JSON。" });
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  const settings = (accountId: string): Settings => ({
    ...(store.getSettings(accountId) || { baseUrl: "https://api.openai.com/v1", model: "" }),
    hasKey: !!key,
  });

  async function callModel(
    accountId: string,
    input: string,
    mode: Mode,
    systemPrompt?: string,
    conversation?: ChatMessage[],
  ) {
    if (busy) throw new ApiError(409, "已有 AI 请求正在处理，请勿重复提交。");
    const conf = settings(accountId);
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
  async function callModelForJson<T>(
    accountId: string,
    payload: object,
    prompt: string,
    schema: z.ZodType<T>,
  ) {
    const raw = await callModel(accountId, JSON.stringify(payload), "summary", prompt);
    try {
      return parseModelJson(raw, schema);
    } catch (e) {
      throw new ApiError(502, e instanceof Error ? e.message : "AI 返回格式无效，请稍后重试。");
    }
  }

  app.get("/api/health", (_req, res) => res.json({ ok: true, mode: "local" }));

  installAuth(app, store, options.mailer, files);

  // 旧版本把 SMTP 授权码以明文存在 app_config 里，启动时就地升级为密文
  migrateSmtpSecret(store);

  // 从请求上取当前登录账号 ID（由 installAuth 的中间件挂载）
  const accountOf = (req: express.Request) =>
    (req as express.Request & { accountId: string }).accountId;

  const ctx: AppContext = {
    store,
    options,
    files,
    upload,
    accountOf,
    settings,
    isBusy: () => busy,
    getKey: () => key,
    setKey: (value: string) => {
      key = value;
    },
    callModel,
    callModelForJson,
  };

  // 领域路由：顺序与拆分前保持一致
  installHistoryRoutes(app, ctx);
  installSettingsRoutes(app, ctx);
  installAiRoutes(app, ctx);
  installKnowledgeRoutes(app, ctx);
  installEntryRoutes(app, ctx);
  installResourceRoutes(app, ctx);
  installTaskRoutes(app, ctx);

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
        return res.status(400).json({
          error: "输入格式不正确，请检查必填内容及字数限制。",
          // 把出错字段一起回给前端，页面才能标红具体那个输入框
          fields: err.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
      if (err instanceof SyntaxError) return res.status(400).json({ error: "请求格式不正确。" });
      if ((err as { type?: string })?.type === "entity.too.large")
        return res.status(413).json({ error: "提交的内容过大。" });
      res.status(500).json({ error: "保存或处理失败，请重试。" });
    },
  );

  return app;
}
