import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { makeLog, reverse, type AuditLog, type Snapshot } from "../shared/audit.js";
import type { ContentData, Entry, Kind, Task, TaskStatus } from "../shared/types.js";

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS entries (
    id        TEXT PRIMARY KEY,
    kind      TEXT NOT NULL,
    title     TEXT NOT NULL,
    data      TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id        TEXT PRIMARY KEY,
    projectId TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    title     TEXT NOT NULL,
    status    TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'done'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    baseUrl TEXT NOT NULL,
    model   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS request_batches (
    requestId TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    titles    TEXT NOT NULL,
    taskIds   TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    id      TEXT UNIQUE NOT NULL,
    payload TEXT NOT NULL
  );
`;

type Row = Record<string, unknown>;

const decode = (row: Row): Entry => ({ ...row, data: JSON.parse(String(row.data)) }) as Entry;

export function createStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);

  const now = () => new Date().toISOString();
  const touchProject = (projectId: string) =>
    db.prepare("UPDATE entries SET updatedAt = ? WHERE id = ?").run(now(), projectId);
  const insertTask = (t: Task) =>
    db.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?)").run(t.id, t.projectId, t.title, t.status);

  const store = {
    db,

    snapshot(): Snapshot {
      return {
        entries: store.list(),
        tasks: db.prepare("SELECT * FROM tasks ORDER BY rowid").all() as unknown as Task[],
      };
    },

    history(): AuditLog[] {
      return db
        .prepare("SELECT payload FROM audit_logs ORDER BY seq DESC")
        .all()
        .map((r) => JSON.parse(String(r.payload)));
    },

    /**
     * 在一个事务里执行写操作，并对比前后快照生成一条操作日志。
     * 没有实际变化时不记日志；任何一步出错都整体回滚。
     */
    audit<T>(action: string, run: () => T): T {
      db.exec("BEGIN IMMEDIATE");
      try {
        const before = store.snapshot();
        const result = run();
        const log = makeLog(before, store.snapshot(), action);
        if (log)
          db.prepare("INSERT INTO audit_logs (id, payload) VALUES (?, ?)").run(
            log.id,
            JSON.stringify(log),
          );
        db.exec("COMMIT");
        return result;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },

    restore(id: string) {
      return store.audit("回溯", () => {
        const log = store.history().find((l) => l.id === id);
        if (!log) throw Error("日志不存在。");
        const next = reverse(store.snapshot(), log);
        const taskChanges = log.changes.filter((c) => c.table === "tasks");
        const entryChanges = log.changes.filter((c) => c.table === "entries");

        // 只改动日志里涉及的行：先删任务，再恢复项目，最后把任务放回去，保证外键成立
        for (const c of taskChanges) db.prepare("DELETE FROM tasks WHERE id = ?").run(c.id);
        for (const c of entryChanges) {
          const e = next.entries.find((e) => e.id === c.id);
          if (!e) {
            db.prepare("DELETE FROM entries WHERE id = ?").run(c.id);
            continue;
          }
          db.prepare(
            `INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title, data = excluded.data, updatedAt = excluded.updatedAt`,
          ).run(e.id, e.kind, e.title, JSON.stringify(e.data), e.createdAt, e.updatedAt);
        }
        for (const c of taskChanges) {
          const t = next.tasks.find((t) => t.id === c.id);
          if (t) insertTask(t);
        }

        log.revertedBy = "restored";
        db.prepare("UPDATE audit_logs SET payload = ? WHERE id = ?").run(JSON.stringify(log), id);
        return { ok: true };
      });
    },

    list(kind?: Kind): Entry[] {
      const rows = kind
        ? db.prepare("SELECT * FROM entries WHERE kind = ? ORDER BY updatedAt DESC").all(kind)
        : db.prepare("SELECT * FROM entries ORDER BY updatedAt DESC").all();
      return rows.map(decode);
    },

    get(id: string): Entry | undefined {
      const row = db.prepare("SELECT * FROM entries WHERE id = ?").get(id);
      return row ? decode(row) : undefined;
    },

    save(kind: Kind, title: string, data: ContentData, id?: string): Entry {
      return store.audit(id ? "修改" : "新增", () => {
        const time = now();
        if (id) {
          db.prepare(
            "UPDATE entries SET title = ?, data = ?, updatedAt = ? WHERE id = ? AND kind = ?",
          ).run(title, JSON.stringify(data), time, id, kind);
        } else {
          id = randomUUID();
          db.prepare(
            "INSERT INTO entries (id, kind, title, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(id, kind, title, JSON.stringify(data), time, time);
        }
        return store.get(id)!;
      });
    },

    remove(id: string) {
      store.audit("删除", () => {
        db.prepare("DELETE FROM entries WHERE id = ?").run(id);
      });
    },

    tasks(projectId: string): Task[] {
      return db
        .prepare("SELECT * FROM tasks WHERE projectId = ? ORDER BY rowid")
        .all(projectId) as unknown as Task[];
    },

    saveTask(projectId: string, title: string, status: TaskStatus, id?: string): Task {
      return store.audit(id ? "修改" : "新增", () => {
        if (id) {
          db.prepare("UPDATE tasks SET title = ?, status = ? WHERE id = ? AND projectId = ?").run(
            title,
            status,
            id,
            projectId,
          );
        } else {
          id = randomUUID();
          insertTask({ id, projectId, title, status });
        }
        touchProject(projectId);
        return { id, projectId, title, status };
      });
    },

    removeTask(projectId: string, id: string) {
      store.audit("删除", () => {
        db.prepare("DELETE FROM tasks WHERE projectId = ? AND id = ?").run(projectId, id);
      });
    },

    /**
     * 把 AI 拆解出的任务一次性加入项目。
     * requestId 由前端生成：网络重试时重复提交同一批，直接返回上次的结果，不会重复插入。
     */
    addTasksBatch(
      projectId: string,
      titles: string[],
      requestId: string,
    ): { tasks: Task[]; replayed: boolean } {
      return store.audit("新增", () => {
        const previous = db
          .prepare("SELECT projectId, titles, taskIds FROM request_batches WHERE requestId = ?")
          .get(requestId) as { projectId: string; titles: string; taskIds: string } | undefined;

        if (previous) {
          if (previous.projectId !== projectId || previous.titles !== JSON.stringify(titles))
            throw Error("该批次编号已被其他内容使用，请重新生成任务草稿。");
          const ids = JSON.parse(previous.taskIds) as string[];
          const tasks = ids
            .map((id) => db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined)
            .filter((t): t is Task => !!t);
          // 这批任务后来被回溯撤销了，不能假装它们还在
          if (tasks.length !== ids.length)
            throw Error("该批次已回溯撤销，请重新生成任务草稿再加入。");
          return { tasks, replayed: true };
        }

        const tasks: Task[] = titles.map((title) => ({
          id: randomUUID(),
          projectId,
          title,
          status: "todo",
        }));
        tasks.forEach(insertTask);
        touchProject(projectId);
        db.prepare("INSERT INTO request_batches VALUES (?, ?, ?, ?, ?)").run(
          requestId,
          projectId,
          JSON.stringify(titles),
          JSON.stringify(tasks.map((t) => t.id)),
          now(),
        );
        return { tasks, replayed: false };
      });
    },

    getSettings() {
      return db.prepare("SELECT baseUrl, model FROM settings WHERE id = 1").get() as
        { baseUrl: string; model: string } | undefined;
    },

    setSettings(baseUrl: string, model: string) {
      db.prepare(
        `INSERT INTO settings VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET baseUrl = excluded.baseUrl, model = excluded.model`,
      ).run(baseUrl, model);
    },
  };

  return store;
}

export type Store = ReturnType<typeof createStore>;
