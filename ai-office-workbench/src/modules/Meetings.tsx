import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { AI_INPUT_LIMIT, type MeetingResult } from "../../shared/ai-schemas";
import { Button, Field, useConfirm } from "../components/ui";
import { Workspace } from "../components/Workspace";
import { api, message } from "../lib/api";
import { useEditor, type ModuleProps } from "../lib/editor";
import { useBusy } from "../lib/useBusy";

interface Draft {
  summary: string;
  todos: string;
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
    </Workspace>
  );
}
