import { useEffect, useState } from "react";
import { ListTodo, Sparkles } from "lucide-react";
import { AI_INPUT_LIMIT, type MeetingResult } from "../../shared/ai-schemas";
import type { Entry } from "../../shared/types";
import { Button, Field, Notice, useConfirm } from "../components/ui";
import { Workspace } from "../components/Workspace";
import { api, message } from "../lib/api";
import { useEditor, type ModuleProps } from "../lib/editor";
import { useBusy } from "../lib/useBusy";

interface Draft {
  summary: string;
  todos: string;
}

/** 把多行待办拆成逐条，过滤空行和重复项。 */
function parseTodos(todos: string): string[] {
  const seen = new Set<string>();
  return todos
    .split("\n")
    .map((line) => line.replace(/^[-*\s\d.、]+/, "").trim())
    .filter((line) => line && !seen.has(line) && (seen.add(line), true));
}

export function Meetings({ onDirty, onBusy, initialId }: ModuleProps) {
  const e = useEditor(
    "meetings",
    { date: "", source: "", summary: "", todos: "" },
    onDirty,
    initialId,
  );
  const [busy, runAi] = useBusy(onBusy);
  const [draft, setDraft] = useState<Draft | null>(null);
  const confirm = useConfirm();
  // 待办转任务：目标项目 + 逐条勾选
  const [projects, setProjects] = useState<Entry[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState("");

  // 打开待办转任务面板时，读取项目列表供选择
  useEffect(() => {
    if (!transferOpen) return;
    api<Entry[]>(`/entries?kind=projects`)
      .then((rows) => {
        setProjects(rows);
        setTargetId(rows[0]?.id || "");
      })
      .catch((err) => setTransferError(message(err)));
  }, [transferOpen]);

  function openTransfer() {
    const items = parseTodos(e.data.todos || "");
    if (!items.length) {
      e.setError("待办事项还是空的，先填写或生成待办，再转为项目任务。");
      return;
    }
    setTransferError("");
    setSelected(new Set(items));
    setTransferOpen(true);
  }

  async function commitTransfer() {
    if (transferBusy || !targetId) return;
    const titles = [...selected].filter(Boolean);
    if (!titles.length) return setTransferError("请至少勾选一条待办。");

    setTransferBusy(true);
    setTransferError("");
    try {
      const result = await api<{ tasks: unknown[] }>(
        `/projects/${targetId}/tasks/batch`,
        "POST",
        { requestId: crypto.randomUUID(), tasks: titles.map((title) => ({ title })) },
      );
      setTransferOpen(false);
      e.setSuccess(`已把 ${result.tasks.length} 条待办加入项目任务。`);
    } catch (err) {
      setTransferError(message(err));
    } finally {
      setTransferBusy(false);
    }
  }

  // 切换到别的会议记录时丢掉上一条的草稿
  const currentId = e.current?.id;
  useEffect(() => setDraft(null), [currentId]);

  async function generate() {
    if (busy) return;
    const source = e.data.source || "";
    if (!source.trim()) return e.setError("请先填写会议原文。");
    if (source.trim().length > AI_INPUT_LIMIT)
      return e.setError("会议原文超过 20,000 字，请缩短后再生成摘要。");
    if (draft && !(await confirm("重新生成会替换当前草稿。确认继续吗？"))) return;

    e.setError("");
    e.setSuccess("");
    await runAi(async () => {
      try {
        const result = await api<MeetingResult>("/ai/meetings", "POST", { title: e.title, source });
        setDraft({ summary: result.summary, todos: result.todos.join("\n") });
        e.setSuccess("摘要草稿已生成，请核对后应用到会议纪要。");
      } catch (err) {
        e.setError(message(err));
      }
    });
  }

  async function apply() {
    if (!draft) return;
    const hasContent = e.data.summary || e.data.todos;
    if (hasContent && !(await confirm("应用会用草稿替换现有的重点与结论和待办事项。确认继续吗？")))
      return;
    e.patch("summary", draft.summary);
    e.patch("todos", draft.todos);
    setDraft(null);
    e.setSuccess("已应用草稿，请核对后点击保存。");
  }

  function discard() {
    setDraft(null);
    e.setSuccess("已放弃草稿，会议纪要内容未变。");
  }

  return (
    <Workspace editor={e} label="会议纪要" busy={busy}>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy || e.saving} onClick={() => void generate()}>
          <Sparkles size={16} />
          {busy ? "正在生成摘要，请稍候…" : "生成摘要草稿"}
        </Button>
        <span className="text-xs text-slate-500">根据会议原文生成草稿，应用后仍需手动保存。</span>
      </div>

      {draft && (
        <div className="grid gap-5 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">AI 摘要草稿（未保存）</h3>
            <span className="text-xs text-slate-500">可直接编辑，应用后才进入会议纪要</span>
          </div>
          <Field label="草稿 · 重点与结论">
            <textarea
              rows={6}
              maxLength={20000}
              value={draft.summary}
              onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
            />
          </Field>
          <Field label="草稿 · 待办事项" hint="每行一项。">
            <textarea
              rows={5}
              maxLength={50000}
              value={draft.todos}
              onChange={(event) => setDraft({ ...draft, todos: event.target.value })}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void apply()}>
              应用到会议纪要
            </Button>
            <Button onClick={discard}>放弃草稿</Button>
          </div>
        </div>
      )}

      <Field label="会议日期">
        <input
          type="date"
          disabled={busy}
          value={e.data.date || ""}
          onChange={(event) => e.patch("date", event.target.value)}
        />
      </Field>
      <Field label="会议原文" hint="生成摘要最多取 20,000 字；超出时请缩短原文，不会自动截断。">
        <textarea
          rows={7}
          maxLength={50000}
          disabled={busy}
          value={e.data.source || ""}
          onChange={(event) => e.patch("source", event.target.value)}
          placeholder="粘贴会议记录或讨论内容…"
        />
      </Field>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="重点与结论">
          <textarea
            rows={7}
            maxLength={50000}
            disabled={busy}
            value={e.data.summary || ""}
            onChange={(event) => e.patch("summary", event.target.value)}
            placeholder="记录本次会议的主要结论…"
          />
        </Field>
        <Field label="待办事项">
          <textarea
            rows={7}
            maxLength={50000}
            disabled={busy}
            value={e.data.todos || ""}
            onChange={(event) => e.patch("todos", event.target.value)}
            placeholder="每行记录一项行动，可填写负责人和截止时间。"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <Button disabled={busy || e.saving || !e.data.todos?.trim()} onClick={openTransfer}>
          <ListTodo size={16} />
          转为项目任务
        </Button>
        <span className="text-xs text-slate-500">
          把待办事项逐行转为某个项目的任务，勾选后写入看板。
        </span>
      </div>

      {transferOpen && (
        <div className="grid gap-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">转为项目任务（未写入）</h3>
            <span className="text-xs text-slate-500">勾选要转的待办，确认后加入目标项目</span>
          </div>
          <Notice error={transferError} />
          <Field label="目标项目">
            <select
              value={targetId}
              disabled={transferBusy}
              onChange={(event) => setTargetId(event.target.value)}
            >
              {projects.length ? (
                projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))
              ) : (
                <option value="">还没有项目，请先到「项目」页新建一个</option>
              )}
            </select>
          </Field>
          <div className="grid gap-2">
            {parseTodos(e.data.todos || "").map((item) => (
              <label key={item} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  disabled={transferBusy}
                  checked={selected.has(item)}
                  onChange={(event) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (event.target.checked) next.add(item);
                      else next.delete(item);
                      return next;
                    })
                  }
                />
                <span className="break-words leading-6">{item}</span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={transferBusy || !targetId || !selected.size}
              onClick={() => void commitTransfer()}
            >
              {transferBusy ? "正在写入…" : `确认加入（${selected.size}）`}
            </Button>
            <Button disabled={transferBusy} onClick={() => setTransferOpen(false)}>
              取消
            </Button>
          </div>
        </div>
      )}
    </Workspace>
  );
}
