import { isPreview } from "./runtime";

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
  if (!res.ok) throw new Error(result.error || "操作失败，请重试。");
  return result;
}

export function message(e: unknown) {
  return e instanceof Error ? e.message : "操作失败，请重试。";
}
