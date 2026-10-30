import { z } from "zod";
import { CONTENT } from "../shared/constants.js";

/** 长文本上限：各模块的正文、原文、摘要等统一限制 */
export const text = z.string().max(CONTENT.textMax);

export const mode = z.enum(["compose", "polish", "summary"]);

export const kinds = z.enum([
  "writing",
  "meetings",
  "projects",
  "documents",
  "knowledge",
  "resources",
]);

export const entrySchema = z
  .object({
    title: z.string().trim().min(1, "请填写标题").max(CONTENT.titleMax),
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
        keywords: z.string().max(CONTENT.keywordsMax).optional(),
        filename: z.string().max(500).optional(),
        ext: z.string().max(20).optional(),
        size: z.number().int().min(0).optional(),
        category: z.string().max(50).optional(),
        downloads: z.number().int().min(0).optional(),
        storedName: z.string().max(200).optional(),
      })
      .strict(),
  })
  .strict();

export const taskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    status: z.enum(["todo", "doing", "done"]),
  })
  .strict();

export const settingsSchema = z
  .object({
    baseUrl: z.string().url().max(500),
    model: z.string().trim().min(1).max(120),
    key: z.string().trim().max(2048).optional(),
    clearKey: z.boolean().optional(),
  })
  .strict();

export const smtpSchema = z
  .object({
    host: z.string().trim().min(1).max(200),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: z.string().trim().min(1).max(200),
    fromName: z.string().trim().max(60).optional(),
    pass: z.string().max(2048).optional(),
    clearPass: z.boolean().optional(),
  })
  .strict();

export const taskBatchSchema = z
  .object({
    requestId: z.string().trim().min(1).max(100),
    tasks: z
      .array(z.object({ title: z.string().trim().min(1).max(200) }).strict())
      .min(1)
      .max(20),
  })
  .strict();
