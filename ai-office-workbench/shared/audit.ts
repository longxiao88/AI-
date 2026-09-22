import type { Entry, Task } from "./types.js";

export interface Snapshot {
  entries: Entry[];
  tasks: Task[];
}

export interface Change {
  table: keyof Snapshot;
  id: string;
  before: Entry | Task | null;
  after: Entry | Task | null;
}

export interface AuditLog {
  id: string;
  at: string;
  action: string;
  title: string;
  changes: Change[];
  revertedBy?: string;
}

type Row = Entry | Task;

/** 深比较两个值，对象按键名排序后再比，忽略键的顺序。 */
export function equal(a: unknown, b: unknown): boolean {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(obj)
          .sort()
          .map((k) => [k, normalize(obj[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** 对比两个快照，列出新增、修改、删除的行。 */
export function difference(before: Snapshot, after: Snapshot): Change[] {
  return (["entries", "tasks"] as const).flatMap((table) => {
    const oldRows = new Map<string, Row>(before[table].map((v) => [v.id, v]));
    const newRows = new Map<string, Row>(after[table].map((v) => [v.id, v]));
    const ids = new Set([...oldRows.keys(), ...newRows.keys()]);

    return [...ids].flatMap((id) => {
      const old = oldRows.get(id) || null;
      const next = newRows.get(id) || null;
      return equal(old, next) ? [] : [{ table, id, before: old, after: next }];
    });
  });
}

/**
 * 计算撤销某条日志后的数据。
 * 如果日志涉及的数据之后又被改过，直接拒绝，避免覆盖后来的修改。
 */
export function reverse(current: Snapshot, log: AuditLog): Snapshot {
  if (log.revertedBy) throw Error("该操作已经回溯，请刷新日志。");
  for (const c of log.changes) {
    const now = current[c.table].find((v) => v.id === c.id) || null;
    if (!equal(now, c.after)) throw Error("相关内容已有后续修改，请先回溯较新的相关操作。");
  }

  const next = structuredClone(current);
  for (const table of ["entries", "tasks"] as const) {
    const rows = new Map<string, Row>(next[table].map((v) => [v.id, v]));
    for (const c of log.changes.filter((v) => v.table === table)) {
      if (c.before) rows.set(c.id, c.before);
      else rows.delete(c.id);
    }
    (next[table] as Row[]) = [...rows.values()];
  }

  const orphan = next.tasks.some(
    (t) => !next.entries.some((e) => e.id === t.projectId && e.kind === "projects"),
  );
  if (orphan) throw Error("项目仍有关联任务，请先回溯相关任务操作。");
  return next;
}

export function makeLog(before: Snapshot, after: Snapshot, action: string): AuditLog | null {
  const changes = difference(before, after);
  if (!changes.length) return null;
  // 同时改了项目和任务时，用任务名作为日志标题，更容易看出做了什么
  const main = changes.find((c) => c.table === "tasks") || changes[0];

  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    action,
    title: (main.after || main.before)!.title,
    changes,
  };
}
