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
    accountId TEXT NOT NULL,
    kind      TEXT NOT NULL,
    title     TEXT NOT NULL,
    data      TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id        TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    projectId TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    title     TEXT NOT NULL,
    status    TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'done'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    accountId TEXT PRIMARY KEY,
    baseUrl   TEXT NOT NULL,
    model     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS request_batches (
    requestId TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    projectId TEXT NOT NULL,
    titles    TEXT NOT NULL,
    taskIds   TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    seq       INTEGER PRIMARY KEY AUTOINCREMENT,
    id        TEXT UNIQUE NOT NULL,
    accountId TEXT NOT NULL,
    payload   TEXT NOT NULL
  );

  -- 全局应用级配置（服务级，非某个账号独有），目前用于 SMTP 发件设置
  CREATE TABLE IF NOT EXISTS app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

type Row = Record<string, unknown>;

const decode = (row: Row): Entry => ({ ...row, data: JSON.parse(String(row.data)) }) as Entry;

export function createStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);

  // 全新数据库的表已带 accountId，可直接建索引；旧库在 migrate 时补建
  if (hasAccountId(db, "entries")) ensureIndexes(db);

  const now = () => new Date().toISOString();
  const touchProject = (accountId: string, projectId: string) =>
    db
      .prepare("UPDATE entries SET updatedAt = ? WHERE id = ? AND accountId = ?")
      .run(now(), projectId, accountId);
  const insertTask = (t: Task) =>
    db
      .prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?)")
      .run(t.id, t.accountId!, t.projectId, t.title, t.status);

  const store = {
    db,

    /** 数据库文件路径；SMTP 授权码的加密密钥文件放在同一目录下 */
    dbPath: path,

    snapshot(accountId: string): Snapshot {
      return {
        entries: store.list(accountId),
        tasks: db
          .prepare("SELECT * FROM tasks WHERE accountId = ? ORDER BY rowid")
          .all(accountId) as unknown as Task[],
      };
    },

    history(accountId: string): AuditLog[] {
      return db
        .prepare("SELECT payload FROM audit_logs WHERE accountId = ? ORDER BY seq DESC")
        .all(accountId)
        .map((r) => JSON.parse(String(r.payload)));
    },

    /**
     * 在一个事务里执行写操作，并对比前后快照生成一条操作日志。
     * 没有实际变化时不记日志；任何一步出错都整体回滚。
     */
    audit<T>(accountId: string, action: string, run: () => T): T {
      db.exec("BEGIN IMMEDIATE");
      try {
        const before = store.snapshot(accountId);
        const result = run();
        const log = makeLog(before, store.snapshot(accountId), action);
        if (log)
          db.prepare("INSERT INTO audit_logs (id, accountId, payload) VALUES (?, ?, ?)").run(
            log.id,
            accountId,
            JSON.stringify(log),
          );
        db.exec("COMMIT");
        return result;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },

    restore(accountId: string, id: string) {
      return store.audit(accountId, "回溯", () => {
        const log = store.history(accountId).find((l) => l.id === id);
        if (!log) throw Error("日志不存在。");
        const next = reverse(store.snapshot(accountId), log);
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
            `INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title, data = excluded.data, updatedAt = excluded.updatedAt`,
          ).run(e.id, accountId, e.kind, e.title, JSON.stringify(e.data), e.createdAt, e.updatedAt);
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

    list(accountId: string, kind?: Kind): Entry[] {
      const rows = kind
        ? db
            .prepare(
              "SELECT * FROM entries WHERE accountId = ? AND kind = ? ORDER BY updatedAt DESC",
            )
            .all(accountId, kind)
        : db
            .prepare("SELECT * FROM entries WHERE accountId = ? ORDER BY updatedAt DESC")
            .all(accountId);
      return rows.map(decode);
    },

    get(accountId: string, id: string): Entry | undefined {
      const row = db
        .prepare("SELECT * FROM entries WHERE id = ? AND accountId = ?")
        .get(id, accountId);
      return row ? decode(row) : undefined;
    },

    save(accountId: string, kind: Kind, title: string, data: ContentData, id?: string): Entry {
      return store.audit(accountId, id ? "修改" : "新增", () => {
        const time = now();
        if (id) {
          db.prepare(
            "UPDATE entries SET title = ?, data = ?, updatedAt = ? WHERE id = ? AND accountId = ? AND kind = ?",
          ).run(title, JSON.stringify(data), time, id, accountId, kind);
        } else {
          id = randomUUID();
          db.prepare(
            "INSERT INTO entries (id, accountId, kind, title, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
          ).run(id, accountId, kind, title, JSON.stringify(data), time, time);
        }
        return store.get(accountId, id)!;
      });
    },

    remove(accountId: string, id: string) {
      store.audit(accountId, "删除", () => {
        db.prepare("DELETE FROM entries WHERE id = ? AND accountId = ?").run(id, accountId);
      });
    },

    tasks(accountId: string, projectId: string): Task[] {
      return db
        .prepare("SELECT * FROM tasks WHERE projectId = ? AND accountId = ? ORDER BY rowid")
        .all(projectId, accountId) as unknown as Task[];
    },

    saveTask(
      accountId: string,
      projectId: string,
      title: string,
      status: TaskStatus,
      id?: string,
    ): Task {
      return store.audit(accountId, id ? "修改" : "新增", () => {
        if (id) {
          db.prepare(
            "UPDATE tasks SET title = ?, status = ? WHERE id = ? AND projectId = ? AND accountId = ?",
          ).run(title, status, id, projectId, accountId);
        } else {
          id = randomUUID();
          insertTask({ id, accountId, projectId, title, status });
        }
        touchProject(accountId, projectId);
        return { id, accountId, projectId, title, status };
      });
    },

    removeTask(accountId: string, projectId: string, id: string) {
      store.audit(accountId, "删除", () => {
        db.prepare("DELETE FROM tasks WHERE projectId = ? AND id = ? AND accountId = ?").run(
          projectId,
          id,
          accountId,
        );
      });
    },

    /**
     * 把 AI 拆解出的任务一次性加入项目。
     * requestId 由前端生成：网络重试时重复提交同一批，直接返回上次的结果，不会重复插入。
     */
    addTasksBatch(
      accountId: string,
      projectId: string,
      titles: string[],
      requestId: string,
    ): { tasks: Task[]; replayed: boolean } {
      return store.audit(accountId, "新增", () => {
        const previous = db
          .prepare(
            "SELECT projectId, titles, taskIds FROM request_batches WHERE requestId = ? AND accountId = ?",
          )
          .get(requestId, accountId) as
          | { projectId: string; titles: string; taskIds: string }
          | undefined;

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
          accountId,
          projectId,
          title,
          status: "todo",
        }));
        tasks.forEach(insertTask);
        touchProject(accountId, projectId);
        db.prepare("INSERT INTO request_batches VALUES (?, ?, ?, ?, ?, ?)").run(
          requestId,
          accountId,
          projectId,
          JSON.stringify(titles),
          JSON.stringify(tasks.map((t) => t.id)),
          now(),
        );
        return { tasks, replayed: false };
      });
    },

    getSettings(accountId: string) {
      return db.prepare("SELECT baseUrl, model FROM settings WHERE accountId = ?").get(accountId) as
        | { baseUrl: string; model: string }
        | undefined;
    },

    /** 资源下载计数 +1（轻量更新，不记操作日志） */
    bumpDownloads(accountId: string, id: string) {
      db.prepare(
        "UPDATE entries SET data = json_set(data, '$.downloads', COALESCE(json_extract(data, '$.downloads'), 0) + 1), updatedAt = ? WHERE id = ? AND accountId = ? AND kind = 'resources'",
      ).run(new Date().toISOString(), id, accountId);
    },

    setSettings(accountId: string, baseUrl: string, model: string) {
      db.prepare(
        `INSERT INTO settings VALUES (?, ?, ?)
         ON CONFLICT(accountId) DO UPDATE SET baseUrl = excluded.baseUrl, model = excluded.model`,
      ).run(accountId, baseUrl, model);
    },

    // ---- 全局应用配置（SMTP 等）----

    getAppConfig(key: string): string | undefined {
      const row = db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
      return row?.value;
    },

    setAppConfig(key: string, value: string) {
      db.prepare(
        `INSERT INTO app_config VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(key, value);
    },
  };

  return store;
}

export type Store = ReturnType<typeof createStore>;

function hasAccountId(db: DatabaseSync, table: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === "accountId");
}

function ensureIndexes(db: DatabaseSync) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_entries_account ON entries(accountId, kind);
    CREATE INDEX IF NOT EXISTS idx_tasks_account ON tasks(accountId);
    CREATE INDEX IF NOT EXISTS idx_audit_account ON audit_logs(accountId);
  `);
}

/**
 * 旧版本（单账号）的数据表没有 accountId 字段。
 * 首次升级时把存量数据归到第一个账号名下，保证不丢数据。
 * 迁移顺序在 installAuth 注册账号之后、任何读写之前调用。
 */
export function migrate(db: DatabaseSync, firstAccountId: string) {
  // 已经是多账号结构则跳过
  if (hasAccountId(db, "entries")) {
    ensureIndexes(db);
    return;
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const legacySettings = db
      .prepare("SELECT baseUrl, model FROM settings WHERE id = 1")
      .get() as { baseUrl: string; model: string } | undefined;

    db.exec(`
      ALTER TABLE entries ADD COLUMN accountId TEXT;
      ALTER TABLE tasks ADD COLUMN accountId TEXT;
      ALTER TABLE request_batches ADD COLUMN accountId TEXT;
      ALTER TABLE audit_logs ADD COLUMN accountId TEXT;
    `);
    db.prepare("UPDATE entries SET accountId = ?").run(firstAccountId);
    db.prepare("UPDATE tasks SET accountId = ?").run(firstAccountId);
    db.prepare("UPDATE request_batches SET accountId = ?").run(firstAccountId);
    db.prepare("UPDATE audit_logs SET accountId = ?").run(firstAccountId);

    // settings 表主键从固定 id=1 改为 accountId
    db.exec("DROP TABLE settings");
    db.exec(`
      CREATE TABLE settings (
        accountId TEXT PRIMARY KEY,
        baseUrl   TEXT NOT NULL,
        model     TEXT NOT NULL
      );
    `);
    if (legacySettings)
      db.prepare("INSERT INTO settings VALUES (?, ?, ?)").run(
        firstAccountId,
        legacySettings.baseUrl,
        legacySettings.model,
      );

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  ensureIndexes(db);
}
