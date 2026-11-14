import { useEffect, useState } from "react";
import { ListTodo, Sparkles } from "lucide-react";
import { AI_INPUT_LIMIT, type MeetingResult } from "../../shared/ai-schemas";
import type { Entry } from "../../shared/types";
import { Button, Field, Notice, useConfirm } from "../components/ui";
import { Workspace } from "../components/Workspace";
import { api, message } from "../lib/api";
import { useEditor, type ModuleProps } from "../lib/editor";
import { useBusy } from "../lib/useBusy";
import { useI18n } from "../lib/i18n";

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
  const { t } = useI18n();
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
      e.setError(t("meetings.todoEmpty"));
      return;
    }
    setTransferError("");
    setSelected(new Set(items));
    setTransferOpen(true);
  }

  async function commitTransfer() {
    if (transferBusy || !targetId) return;
    const titles = [...selected].filter(Boolean);
    if (!titles.length) return setTransferError(t("meetings.needTodo"));

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
    if (!source.trim()) return e.setError(t("meetings.needSource"));
    if (source.trim().length > AI_INPUT_LIMIT)
      return e.setError(t("meetings.tooLong"));
    if (draft && !(await confirm(t("meetings.regenConfirm")))) return;

    e.setError("");
    e.setSuccess("");
    await runAi(async () => {
      try {
        const result = await api<MeetingResult>("/ai/meetings", "POST", { title: e.title, source });
        setDraft({ summary: result.summary, todos: result.todos.join("\n") });
        e.setSuccess(t("meetings.draftReady"));
      } catch (err) {
        e.setError(message(err));
      }
    });
  }

  async function apply() {
    if (!draft) return;
    const hasContent = e.data.summary || e.data.todos;
    if (hasContent && !(await confirm(t("meetings.applyConfirm"))))
      return;
    e.patch("summary", draft.summary);
    e.patch("todos", draft.todos);
    setDraft(null);
    e.setSuccess(t("meetings.applied"));
  }

  function discard() {
    setDraft(null);
    e.setSuccess(t("meetings.discarded"));
  }

  return (
    <Workspace editor={e} label={t("module.meetings")} busy={busy}>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy || e.saving} onClick={() => void generate()}>
          <Sparkles size={16} />
          {busy ? t("meetings.generating") : t("meetings.generate")}
        </Button>
        <span className="text-xs text-slate-500">{t("meetings.genHint")}</span>
      </div>

      {draft && (
        <div className="grid gap-5 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t("meetings.draftTitle")}</h3>
            <span className="text-xs text-slate-500">{t("meetings.draftEditable")}</span>
          </div>
          <Field label={t("meetings.draftPoints")}>
            <textarea
              rows={6}
              maxLength={20000}
              value={draft.summary}
              onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
            />
          </Field>
          <Field label={t("meetings.draftTodos")} hint={t("meetings.oneLine")}>
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
            <Button onClick={discard}>{t("meetings.discard")}</Button>
          </div>
        </div>
      )}

      <Field label={t("meetings.date")}>
        <input
          type="date"
          disabled={busy}
          value={e.data.date || ""}
          onChange={(event) => e.patch("date", event.target.value)}
        />
      </Field>
      <Field label={t("meetings.source")} hint={t("meetings.limitHint")}>
        <textarea
          rows={7}
          maxLength={50000}
          disabled={busy}
          value={e.data.source || ""}
          onChange={(event) => e.patch("source", event.target.value)}
          placeholder={t("meetings.sourcePlaceholder")}
        />
      </Field>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label={t("meetings.points")}>
          <textarea
            rows={7}
            maxLength={50000}
            disabled={busy}
            value={e.data.summary || ""}
            onChange={(event) => e.patch("summary", event.target.value)}
            placeholder={t("meetings.pointsPlaceholder")}
          />
        </Field>
        <Field label={t("meetings.todos")}>
          <textarea
            rows={7}
            maxLength={50000}
            disabled={busy}
            value={e.data.todos || ""}
            onChange={(event) => e.patch("todos", event.target.value)}
            placeholder={t("meetings.todoHint")}
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
            <h3 className="text-sm font-medium">{t("meetings.toTasks")}</h3>
            <span className="text-xs text-slate-500">{t("meetings.todoPick")}</span>
          </div>
          <Notice error={transferError} />
          <Field label={t("meetings.targetProject")}>
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
                <option value="">{t("meetings.noProject")}</option>
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
              {transferBusy ? t("meetings.writing") : `确认加入（${selected.size}）`}
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
