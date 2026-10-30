import type { Express } from "express";
import { ApiError } from "../ai.js";
import type { AppContext } from "../context.js";

/** 操作日志：查看与撤销 */
export function installHistoryRoutes(app: Express, ctx: AppContext) {
  app.get("/api/history", (req, res) => res.json(ctx.store.history(ctx.accountOf(req))));

  app.post("/api/history/:id/restore", (req, res) => {
    try {
      res.json(ctx.store.restore(ctx.accountOf(req), String(req.params.id)));
    } catch (e) {
      throw new ApiError(409, e instanceof Error ? e.message : "回溯失败。");
    }
  });
}
