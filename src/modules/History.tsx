import { useEffect, useRef, useState } from "react";
import type { AuditLog, Change } from "../../shared/audit";
import type { Entry } from "../../shared/types";
import { Button, Empty, Field, Notice, useConfirm } from "../components/ui";
import { api, message } from "../lib/api";

// 日志里出现的模块名、字段名、状态值对应的中文
const names: Record<string, string> = {
  writing: "AI 写作",
  meetings: "会议纪要",
  projects: "项目管理",
  documents: "文档分析",
  knowledge: "知识库",
  title: "标题",
  input: "输入",
  output: "结果",
  mode: "模式",
  date: "日期",
  source: "原文",
  summary: "摘要",
  todos: "待办",
  notes: "笔记",
  description: "描述",
  keywords: "关键词",
  status: "状态",
  todo: "待开始",
  doing: "进行中",
  done: "已完成",
  compose: "撰写",
  polish: "润色",
};

const moduleName = (c: Change) =>
  c.table === "tasks" ? "任务" : names[((c.after || c.before) as Entry | null)?.kind || ""];

/** 把一行数据格式化成便于阅读的文本，用于前后对比 */
function content(row: Change["before"]) {
  if (!row) return "（不存在）";
  const fields =
    "data" in row ? { title: row.title, ...row.data } : { title: row.title, status: row.status };
  return Object.entries(fields)
    .map(
      ([k, v]) => `${names[k] || k}：${k === "status" || k === "mode" ? names[String(v)] || v : v}`,
    )
    .join("\n\n");
}

export function History() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const confirm = useConfirm();

  async function load() {
    setLogs(await api<AuditLog[]>("/history"));
  }

  useEffect(() => {
    load()
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  }, []);

  async function restore(log: AuditLog) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try {
      if (
        !(await confirm(
          `确认回溯「${log.title}」的这次${log.action}？将恢复操作前内容；新增记录会被移除，删除的项目及任务会一起恢复。`,
        ))
      )
        return;
      setError("");
      setSuccess("");
      await api(`/history/${log.id}/restore`, "POST", {});
      await load();
      setSuccess("已恢复操作前的内容，并记录本次回溯。");
    } catch (e) {
      setError(message(e));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  const keyword = query.trim();
  const visible = logs.filter((log) => {
    const text = [log.title, log.action, log.at, ...log.changes.map(moduleName)].join(" ");
    return text.includes(keyword);
  });

  return (
    <div className="history-page grid gap-5">
      <p className="text-sm text-slate-500">
        记录写作、会议、项目、文档、知识库及任务的保存、修改、删除。展开可查看前后内容；已有后续修改时，请先回溯较新的相关操作。历史从功能启用后开始记录。
      </p>
      <Field label="搜索操作日志">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入标题、模块或操作"
        />
      </Field>
      <Notice error={error} success={success} />
      {loading ? (
        <p role="status">正在读取日志…</p>
      ) : !visible.length ? (
        <Empty
          text={query ? "没有匹配的操作。" : "暂无操作日志。保存或修改一条记录后，会显示在这里。"}
        />
      ) : (
        <div className="grid gap-3">
          {visible.map((log) => (
            <article className="panel p-5" key={log.id}>
              <div className="history-heading">
                <div>
                  <span className="history-badge">{log.action}</span>
                  <strong>{log.title}</strong>
                  <p className="text-xs text-slate-500 mt-2">
                    <time dateTime={log.at}>
                      {new Date(log.at).toLocaleString("zh-CN", {
                        hour12: false,
                      })}
                    </time>{" "}
                    · 当前工作空间 · {log.changes.length} 项变更
                  </p>
                </div>
                <Button disabled={busy || !!log.revertedBy} onClick={() => void restore(log)}>
                  {log.revertedBy ? "已回溯" : "回溯此操作"}
                </Button>
              </div>
              <details className="mt-4">
                <summary>查看变更前后</summary>
                {log.changes.map((c) => (
                  <section className="mt-4" key={`${c.table}-${c.id}`}>
                    <h3 className="text-sm mb-2">
                      {moduleName(c)} · {(c.after || c.before)!.title}
                    </h3>
                    <div className="history-diff">
                      <div>
                        <h4>操作前</h4>
                        <pre>{content(c.before)}</pre>
                      </div>
                      <div>
                        <h4>操作后</h4>
                        <pre>{content(c.after)}</pre>
                      </div>
                    </div>
                  </section>
                ))}
              </details>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
