import test from "node:test";
import assert from "node:assert/strict";
import type { Entry, Task } from "../shared/types.js";
import { createPreviewApi } from "../src/lib/preview.js";

function memory() {
  const data = new Map<string, string>();

  return {
    getItem: (key: string) => data.get(key) || null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    data,
  };
}
test("preview writes remain in visitor storage and survive reopening, all examples labelled", async () => {
  const storage = memory();
  const api = createPreviewApi(storage);
  // 注册并登录演示账号，之后数据按账号隔离保存
  await api("/auth/setup", "POST", { username: "demo", password: "password123", name: "演示" });
  const rows = await api<Entry[]>("/entries");
  assert.equal(rows.length, 5);
  assert.ok(rows.every((e) => e.title.startsWith("示例")));
  for (const kind of ["writing", "meetings", "projects", "documents"]) {
    const value = await api<Entry>(`/entries/${kind}`, "POST", {
      title: "my record",
      data: {},
    });
    const updated = await api<Entry>(`/entries/${value.id}`, "PUT", {
      title: "edited",
      data: { notes: "saved" },
    });
    assert.equal(updated.title, "edited");
    const reopened = createPreviewApi(storage);
    assert.equal(((await reopened<Entry>(`/entries/${value.id}`)).data as { notes?: string }).notes, "saved");
    await api(`/entries/${value.id}`, "DELETE");
    await assert.rejects(() => api(`/entries/${value.id}`));
  }
  const project = await api<Entry>("/entries/projects", "POST", {
    title: "test",
    data: {},
  });
  const task = await api<Task>(`/projects/${project.id}/tasks`, "POST", {
    title: "task",
    status: "todo",
  });
  await api(`/projects/${project.id}/tasks/${task.id}`, "PUT", {
    title: "edited",
    status: "done",
  });
  assert.equal((await api<Task[]>(`/projects/${project.id}/tasks`))[0].status, "done");
  await api(`/entries/${project.id}`, "DELETE");
  const saved = JSON.parse(storage.data.get("ai-office-preview-v2:demo")!);
  assert.ok(!saved.tasks.some((t: Task) => t.id === task.id));
  assert.ok(saved.history.some((log: any) => log.changes.some((c: any) => c.id === task.id)));
  // 独立的存储实例（新访客）看不到 demo 账号的数据
  const second = createPreviewApi(memory());
  await second("/auth/setup", "POST", { username: "other", password: "password123", name: "其他" });
  assert.equal((await second<Entry[]>("/entries")).length, 5);
});
test("preview rejects AI and key operations without storing secrets; no false success", async () => {
  const storage = memory();
  const api = createPreviewApi(storage);
  for (const path of ["/settings", "/settings/key", "/ai/test", "/ai/generate"])
    await assert.rejects(() => api(path, "POST", { key: "NEVER_SAVE_ME", input: "x" }));
  assert.equal(storage.data.size, 0);
  assert.equal((await api<{ hasKey: boolean }>("/settings")).hasKey, false);
});
