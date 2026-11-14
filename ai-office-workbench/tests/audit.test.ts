import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditLog } from "../shared/audit.js";
import type { Entry, Task } from "../shared/types.js";
import { createStore } from "../server/db.js";
import { createPreviewApi } from "../src/lib/preview.js";

test("SQLite logs survive reopen; reverse CRUD and cascade deletion atomically, reject conflicts/repeats", () => {
  const dir = mkdtempSync(join(tmpdir(), "office-audit-"));
  const file = join(dir, "test.db");
  const account = "tester";
  let s = createStore(file);
  try {
    for (const kind of ["writing", "meetings", "projects", "documents", "knowledge"] as const) {
      const e = s.save(account, kind, kind, { source: "before" });
      const created = s.history(account)[0];
      s.save(account, kind, "changed", { source: "after" }, e.id);
      const updated = s.history(account)[0];
      assert.equal(updated.action, "修改");
      assert.throws(() => s.restore(account, created.id), /后续修改/);
      s.restore(account, updated.id);
      assert.equal(s.get(account, e.id)!.title, kind);
      assert.throws(() => s.restore(account, updated.id), /已经回溯/);
      s.remove(account, e.id);
      const deleted = s.history(account)[0];
      s.restore(account, deleted.id);
      assert.equal((s.get(account, e.id)!.data as { source?: string }).source, "before");
      s.restore(account, created.id);
      assert.equal(s.get(account, e.id), undefined);
    }
    const p = s.save(account, "projects", "project", {});
    const t = s.saveTask(account, p.id, "child", "doing");
    s.remove(account, p.id);
    const deletion = s.history(account)[0];
    assert.equal(deletion.changes.length, 2);
    s.db.close();
    s = createStore(file);
    s.restore(account, deletion.id);
    assert.equal(s.tasks(account, p.id)[0].id, t.id);
    s.removeTask(account, p.id, t.id);
    s.restore(account, s.history(account)[0].id);
    assert.equal(s.tasks(account, p.id).length, 1);
    const n = s.history(account).length;
    assert.throws(() => s.saveTask(account, "absent", "fail", "todo"));
    assert.equal(s.history(account).length, n);
    // Failure to persist an audit record must roll back the business mutation as well.
    s.db.exec(
      "CREATE TRIGGER reject_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'test failure'); END",
    );
    assert.throws(() => s.save(account, "writing", "must rollback", {}));
    assert.ok(!s.list(account).some((e) => e.title === "must rollback"));
  } finally {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("preview history persists atomically, restores project tasks, isolates visitors, rejects conflicting and duplicate restore", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) || null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
  let api = createPreviewApi(storage);
  // 注册并登录一个演示账号
  await api("/auth/setup", "POST", { username: "alice", password: "password123", name: "Alice" });
  const p = await api<Entry>("/entries/projects", "POST", {
    title: "项目",
    data: {},
  });
  const t = await api<Task>(`/projects/${p.id}/tasks`, "POST", {
    title: "任务",
    status: "todo",
  });
  const history = () => api<AuditLog[]>("/history");
  const created = (await history())[0];
  await api(`/projects/${p.id}/tasks/${t.id}`, "PUT", {
    title: "任务改",
    status: "done",
  });
  await assert.rejects(api(`/history/${created.id}/restore`, "POST"), /后续修改/);
  await api(`/entries/${p.id}`, "DELETE");
  const deletion = (await history())[0];
  api = createPreviewApi(storage);
  await api(`/history/${deletion.id}/restore`, "POST");
  assert.equal((await api<Task[]>(`/projects/${p.id}/tasks`))[0].status, "done");
  await assert.rejects(api(`/history/${deletion.id}/restore`, "POST"), /已经回溯/);
  // 未登录访客的 history 为空（独立的存储实例）
  assert.equal(
    (await createPreviewApi({ getItem: () => null, setItem: () => {} })<AuditLog[]>("/history"))
      .length,
    0,
  );
  // 账号 A 的数据与账号 B 相互隔离
  await api("/auth/logout", "POST");
  await api("/auth/setup", "POST", { username: "bob", password: "password123", name: "Bob" });
  assert.equal((await api<AuditLog[]>("/history")).length, 0);
  assert.equal((await api<Entry[]>("/entries")).length, 5); // 只有示例数据
  // 存储满时写入报错
  const full = createPreviewApi({
    getItem: (k: string) => values.get(k) || null,
    setItem: () => {
      throw Error("full");
    },
  });
  await assert.rejects(
    full("/entries/writing", "POST", { title: "fail", data: {} }),
    /未能保存/,
  );
});
