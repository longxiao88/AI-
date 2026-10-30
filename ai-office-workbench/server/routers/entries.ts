import type { Express } from "express";
import { ApiError } from "../ai.js";
import type { AppContext } from "../context.js";
import { entrySchema, kinds } from "../schemas.js";

/** 六类记录（写作 / 会议 / 项目 / 文档 / 知识库 / 资源库）的增删改查 */
export function installEntryRoutes(app: Express, ctx: AppContext) {
  const findEntry = (accountId: string, id: string) => {
    const item = ctx.store.get(accountId, id);
    if (!item) throw new ApiError(404, "记录不存在或已删除。");
    return item;
  };

  app.get("/api/entries", (req, res) => {
    const kind = req.query.kind ? kinds.parse(req.query.kind) : undefined;
    res.json(ctx.store.list(ctx.accountOf(req), kind));
  });

  app.get("/api/entries/:id", (req, res) => {
    res.json(findEntry(ctx.accountOf(req), String(req.params.id)));
  });

  app.post("/api/entries/:kind", (req, res) => {
    const kind = kinds.parse(req.params.kind);
    const { title, data } = entrySchema.parse(req.body);
    res.status(201).json(ctx.store.save(ctx.accountOf(req), kind, title, data));
  });

  app.put("/api/entries/:id", (req, res) => {
    const accountId = ctx.accountOf(req);
    const item = findEntry(accountId, String(req.params.id));
    const { title, data } = entrySchema.parse(req.body);
    res.json(ctx.store.save(accountId, item.kind, title, data, item.id));
  });

  app.delete("/api/entries/:id", (req, res) => {
    const accountId = ctx.accountOf(req);
    const id = String(req.params.id);
    const item = ctx.store.get(accountId, id);
    // 删除资源时一并清理磁盘上的文件，避免孤儿文件堆积
    if (item?.kind === "resources" && item.data.storedName) {
      ctx.files.remove(item.data.storedName);
    }
    ctx.store.remove(accountId, id);
    res.json({ ok: true });
  });
}
