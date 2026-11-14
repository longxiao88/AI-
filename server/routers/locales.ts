import type { Express } from "express";
import type { AppContext } from "../context.js";
import { listLocalePacks, revealLocaleDir } from "../locales.js";

/**
 * 语言包：列目录、打开目录。
 * 模板下载放在前端做 —— 只有前端知道全部文案 key 和中文原文。
 */
export function installLocaleRoutes(app: Express, _ctx: AppContext) {
  app.get("/api/locales", (_req, res) => res.json(listLocalePacks()));

  app.post("/api/locales/reveal", (_req, res) => {
    res.json({ dir: revealLocaleDir() });
  });
}
