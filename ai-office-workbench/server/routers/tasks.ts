import type { Express } from "express";
import { ApiError } from "../ai.js";
import type { AppContext } from "../context.js";
import { taskBatchSchema, taskSchema } from "../schemas.js";

/** 项目任务：列表、单条增改删、从会议待办批量加入 */
export function installTaskRoutes(app: Express, ctx: AppContext) {
  // 项目不存在时直接 404，避免后续所有任务接口都要判断一次
  app.use("/api/projects/:projectId/tasks", (req, _res, next) => {
    if (ctx.store.get(ctx.accountOf(req), String(req.params.projectId))?.kind !== "projects")
      throw new ApiError(404, "项目不存在。");
    next();
  });

  app.get("/api/projects/:projectId/tasks", (req, res) => {
    res.json(ctx.store.tasks(ctx.accountOf(req), String(req.params.projectId)));
  });

  app.post("/api/projects/:projectId/tasks", (req, res) => {
    const { title, status } = taskSchema.parse(req.body);
    res
      .status(201)
      .json(ctx.store.saveTask(ctx.accountOf(req), String(req.params.projectId), title, status));
  });

  app.post("/api/projects/:projectId/tasks/batch", (req, res) => {
    const { requestId, tasks } = taskBatchSchema.parse(req.body);
    try {
      const result = ctx.store.addTasksBatch(
        ctx.accountOf(req),
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
    const accountId = ctx.accountOf(req);
    const projectId = String(req.params.projectId);
    const id = String(req.params.id);
    const { title, status } = taskSchema.parse(req.body);
    if (!ctx.store.tasks(accountId, projectId).some((t) => t.id === id))
      throw new ApiError(404, "任务不存在。");
    res.json(ctx.store.saveTask(accountId, projectId, title, status, id));
  });

  app.delete("/api/projects/:projectId/tasks/:id", (req, res) => {
    ctx.store.removeTask(ctx.accountOf(req), String(req.params.projectId), String(req.params.id));
    res.json({ ok: true });
  });
}
