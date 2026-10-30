import type { Express } from "express";
import { ApiError } from "../ai.js";
import type { AppContext } from "../context.js";
import { LOCAL_HOSTS } from "../hosts.js";
import { settingsSchema, smtpSchema } from "../schemas.js";
import { saveSmtp, smtpView } from "../smtp.js";

/** 只允许 HTTPS；本机调试用的模型服务可以走 HTTP。 */
export function isAllowedBaseUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) return false;
  return (
    url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname))
  );
}

/** 模型连接设置与 SMTP 发件配置 */
export function installSettingsRoutes(app: Express, ctx: AppContext) {
  app.get("/api/settings", (req, res) => res.json(ctx.settings(ctx.accountOf(req))));

  app.put("/api/settings", (req, res) => {
    const accountId = ctx.accountOf(req);
    const value = settingsSchema.parse(req.body);
    if (!isAllowedBaseUrl(value.baseUrl))
      throw new ApiError(
        400,
        "API 地址需使用 HTTPS（本机服务可用 HTTP），且不包含账号、参数或片段。",
      );
    if (ctx.isBusy()) throw new ApiError(409, "请等待当前 AI 请求结束后再修改设置。");

    ctx.store.setSettings(accountId, value.baseUrl.replace(/\/+$/, ""), value.model);
    if (value.clearKey) ctx.setKey("");
    else if (value.key) ctx.setKey(value.key);
    res.json(ctx.settings(accountId));
  });

  app.delete("/api/settings/key", (req, res) => {
    if (ctx.isBusy()) throw new ApiError(409, "请等待当前 AI 请求结束。");
    ctx.setKey("");
    res.json(ctx.settings(ctx.accountOf(req)));
  });

  // SMTP 发件配置（全局，供账号找回 / 邮箱验证使用）：
  // 读取与保存都交给 server/smtp.ts，环境变量优先，入库的授权码加密存储，
  // 接口只返回 configured 布尔，不返回授权码本身。
  app.get("/api/settings/smtp", (_req, res) => res.json(smtpView(ctx.store)));

  app.put("/api/settings/smtp", (req, res) => {
    const value = smtpSchema.parse(req.body);
    res.json(saveSmtp(ctx.store, value));
  });
}
