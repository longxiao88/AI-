import { z } from "zod";

// 发给模型的原文上限。超过时前端直接提示用户缩短，不做静默截断。
export const AI_INPUT_LIMIT = 20000;

const line = z.string().trim().min(1).max(500);

export const meetingInputSchema = z
  .object({
    title: z.string().trim().max(120),
    source: z.string().trim().min(1).max(AI_INPUT_LIMIT),
  })
  .strict();

export const meetingResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(20000),
    todos: z.array(line).max(50),
  })
  .strict();

export const projectInputSchema = z
  .object({
    title: z.string().trim().max(120),
    description: z.string().trim().min(1).max(AI_INPUT_LIMIT),
  })
  .strict();

export const projectResultSchema = z
  .object({
    tasks: z
      .array(z.object({ title: z.string().trim().min(1).max(200) }).strict())
      .min(1)
      .max(20),
  })
  .strict();

export const documentInputSchema = z
  .object({
    title: z.string().trim().max(120),
    source: z.string().trim().min(1).max(AI_INPUT_LIMIT),
  })
  .strict();

export const documentResultSchema = z
  .object({
    overview: z.string().trim().min(1).max(10000),
    keyPoints: z.array(line).max(30),
    actions: z.array(line).max(30),
  })
  .strict();

export type MeetingResult = z.infer<typeof meetingResultSchema>;

export type ProjectResult = z.infer<typeof projectResultSchema>;

export type DocumentResult = z.infer<typeof documentResultSchema>;

/**
 * 解析模型返回的 JSON。允许外面包一层 ```json 代码块（不少模型习惯这样输出），
 * 其余情况一律按格式错误处理。
 */
export function parseModelJson<T>(raw: string, schema: z.ZodType<T>): T {
  let text = raw.trim();
  const fence = /^```(?:json)?[ \t]*\n([\s\S]*?)\n?```$/.exec(text);
  if (fence) text = fence[1].trim();

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("AI 返回的不是有效的 JSON，请稍后手动重试。");
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "AI 返回的内容不符合约定格式（字段缺失、为空或超出长度限制），请稍后手动重试。",
    );
  return parsed.data;
}
