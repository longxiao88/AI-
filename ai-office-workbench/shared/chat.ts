import { z } from "zod";

// 独立 AI 问答的请求格式：对话由前端整段带上，服务端不保存历史。

export const chatMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(20000),
  })
  .strict();

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** 最多 20 轮：提问与回答交替、以提问结尾，总字数不超过 40,000。 */
export const chatInputSchema = z
  .object({
    messages: z.array(chatMessageSchema).min(1).max(39),
  })
  .strict()
  .refine(
    ({ messages }) =>
      messages.length % 2 === 1 &&
      messages.every((m, i) => m.role === (i % 2 === 0 ? "user" : "assistant")),
    "对话必须从提问开始，交替排列，并以提问结束。",
  )
  .refine(
    ({ messages }) => messages.reduce((n, m) => n + m.content.length, 0) <= 40000,
    "当前对话超过 40,000 字，请导出后开始新对话。",
  );
