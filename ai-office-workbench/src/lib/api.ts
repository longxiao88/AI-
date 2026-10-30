import { isPreview } from "./runtime";

/** 服务端 zod 校验失败时回传的字段级错误 */
type FieldIssue = { path: string; message: string };

export type ApiFailure = Error & { fields?: FieldIssue[] };

export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (isPreview) {
    const { previewApi } = await import("./preview");
    return previewApi<T>(path, method, body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: method === "GET" ? {} : { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error("无法连接本机服务，请确认后端已启动。");
  }
  const result = await res.json().catch(() => ({ error: "服务器返回了无法识别的响应。" }));
  if (!res.ok) {
    // 把字段级错误挂在 Error 上，调用方可以据此标红具体输入框
    const failure = new Error(result.error || "操作失败，请重试。") as ApiFailure;
    failure.fields = Array.isArray(result.fields) ? result.fields : undefined;
    throw failure;
  }
  return result;
}

export function message(e: unknown) {
  return e instanceof Error ? e.message : "操作失败，请重试。";
}
