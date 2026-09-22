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
  let s = createStore(file);
  try {
    for (const kind of ["writing", "meetings", "projects", "documents", "knowledge"] as const) {
      const e = s.save(kind, kind, { source: "before" });
      const created = s.history()[0];
      s.save(kind, "changed", { source: "after" }, e.id);
      const updated = s.history()[0];
      assert.equal(updated.action, "修改");
      assert.throws(() => s.restore(created.id), /后续修改/);
      s.restore(updated.id);
      assert.equal(s.get(e.id)!.title, kind);
      assert.throws(() => s.restore(updated.id), /已经回溯/);
      s.remove(e.id);
      const deleted = s.history()[0];
      s.restore(deleted.id);
      assert.equal(s.get(e.id)!.data.source, "before");
      s.restore(created.id);
      assert.equal(s.get(e.id), undefined);
    }
    const p = s.save("projects", "project", {});
    const t = s.saveTask(p.id, "child", "doing");
    s.remove(p.id);
    const deletion = s.history()[0];
    assert.equal(deletion.changes.length, 2);
    s.db.close();
    s = createStore(file);
    s.restore(deletion.id);
    assert.equal(s.tasks(p.id)[0].id, t.id);
    s.removeTask(p.id, t.id);
    s.restore(s.history()[0].id);
    assert.equal(s.tasks(p.id).length, 1);
    const n = s.history().length;
    assert.throws(() => s.saveTask("absent", "fail", "todo"));
    assert.equal(s.history().length, n);
    // Failure to persist an audit record must roll back the business mutation as well.
    s.db.exec(
      "CREATE TRIGGER reject_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'test failure'); END",
    );
    assert.throws(() => s.save("writing", "must rollback", {}));
    assert.ok(!s.list().some((e) => e.title === "must rollback"));
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
  assert.equal(
    (await createPreviewApi({ getItem: () => null, setItem: () => {} })<AuditLog[]>("/history"))
      .length,
    0,
  );
  const old = JSON.parse(values.get("ai-office-preview-v1")!);
  delete old.history;
  const legacy = createPreviewApi({
    getItem: () => JSON.stringify(old),
    setItem: () => {
      throw Error("full");
    },
  });
  assert.deepEqual(await legacy("/history"), []);
  await assert.rejects(legacy("/entries/writing", "POST", { title: "fail", data: {} }), /未能保存/);
  assert.deepEqual(await legacy("/history"), []);
});
