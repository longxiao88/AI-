import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { AI_INPUT_LIMIT, type DocumentResult } from "../../shared/ai-schemas";
import { Button, Field, useConfirm } from "../components/ui";
import { Workspace } from "../components/Workspace";
import { api, message } from "../lib/api";
import { useEditor, type ModuleProps } from "../lib/editor";
import { useBusy } from "../lib/useBusy";

const MAX_FILE_SIZE = 200 * 1000;
const MAX_TEXT_LENGTH = 50000;

interface Draft {
  overview: string;
  keyPoints: string;
  actions: string;
}

const toLines = (value: string) =>
  value
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);

const numbered = (items: string[]) =>
  items.length ? items.map((v, i) => `${i + 1}. ${v}`) : ["（原文未给出）"];

/** 把草稿拼成带小标题的笔记正文 */
function draftToNotes(draft: Draft) {
  return [
    "【概述】",
    draft.overview.trim(),
    "",
    "【关键要点】",
    ...numbered(toLines(draft.keyPoints)),
    "",
    "【建议行动】",
    ...numbered(toLines(draft.actions)),
  ].join("\n");
}

export function Documents({ onDirty, onBusy, initialId }: ModuleProps) {
  const e = useEditor("documents", { source: "", notes: "" }, onDirty, initialId);
  const [busy, runAi] = useBusy(onBusy);
  const [draft, setDraft] = useState<Draft | null>(null);
  const confirm = useConfirm();

  const currentId = e.current?.id;
  useEffect(() => setDraft(null), [currentId]);

  async function importFile(file?: File) {
    if (!file) return;
    e.setError("");
    try {
      if (!/\.(txt|md|markdown)$/i.test(file.name)) throw Error("请导入 TXT 或 Markdown 文件。");
      if (file.size > MAX_FILE_SIZE) throw Error("文件不能超过 200 KB。");
      // fatal: true 遇到非 UTF-8 编码会直接抛 TypeError，避免导入乱码
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (text.length > MAX_TEXT_LENGTH) throw Error("文本不能超过 50,000 字。");

      e.patch("source", text);
      if (!e.title) e.setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 120));
      e.setSuccess("文件已导入，请保存记录。");
    } catch (error) {
      e.setError(
        error instanceof TypeError
          ? "文件不是有效的 UTF-8 文本，请转换编码后重试。"
          : message(error),
      );
    }
  }

  async function generate() {
    if (busy) return;
    const source = e.data.source || "";
    if (!source.trim()) return e.setError("请先导入或粘贴文档原文。");
    if (source.trim().length > AI_INPUT_LIMIT)
      return e.setError("文档原文超过 20,000 字，请缩短分析内容后再生成。");
    if (draft && !(await confirm("重新生成会替换当前草稿。确认继续吗？"))) return;

    e.setError("");
    e.setSuccess("");
    await runAi(async () => {
      try {
        const result = await api<DocumentResult>("/ai/documents", "POST", {
          title: e.title,
          source,
        });
        setDraft({
          overview: result.overview,
          keyPoints: result.keyPoints.join("\n"),
          actions: result.actions.join("\n"),
        });
        e.setSuccess("分析草稿已生成，请核对后应用到分析笔记。");
      } catch (err) {
        e.setError(message(err));
      }
    });
  }

  async function apply() {
    if (!draft) return;
    if (e.data.notes && !(await confirm("应用会用草稿替换现有的分析笔记。确认继续吗？"))) return;
    e.patch("notes", draftToNotes(draft));
    setDraft(null);
    e.setSuccess("已应用草稿，请核对后点击保存。");
  }

  function discard() {
    setDraft(null);
    e.setSuccess("已放弃草稿，分析笔记内容未变。");
  }

  return (
    <Workspace editor={e} label="文档" busy={busy}>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy || e.saving} onClick={() => void generate()}>
          <Sparkles size={16} />
          {busy ? "正在分析，请稍候…" : "生成分析草稿"}
        </Button>
        <span className="text-xs text-slate-500">仅依据原文生成分析草稿，应用后仍需手动保存。</span>
      </div>

      {draft && (
        <div className="grid gap-5 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">AI 分析草稿（未保存）</h3>
            <span className="text-xs text-slate-500">可直接编辑，应用后才进入分析笔记</span>
          </div>
          <Field label="草稿 · 概述">
            <textarea
              rows={5}
              maxLength={10000}
              value={draft.overview}
              onChange={(event) => setDraft({ ...draft, overview: event.target.value })}
            />
          </Field>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="草稿 · 关键要点" hint="每行一条。">
              <textarea
                rows={6}
                maxLength={20000}
                value={draft.keyPoints}
                onChange={(event) => setDraft({ ...draft, keyPoints: event.target.value })}
              />
            </Field>
            <Field label="草稿 · 建议行动" hint="每行一条。">
              <textarea
                rows={6}
                maxLength={20000}
                value={draft.actions}
                onChange={(event) => setDraft({ ...draft, actions: event.target.value })}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void apply()}>
              应用到分析笔记
            </Button>
            <Button onClick={discard}>放弃草稿</Button>
          </div>
        </div>
      )}

      <Field
        label="导入文本文件"
        hint="支持 UTF-8 编码的 .txt、.md 文件，最多 200 KB / 50,000 字。"
      >
        <input
          type="file"
          accept=".txt,.md,.markdown"
          disabled={busy}
          onChange={(event) => {
            void importFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </Field>
      <div className="grid gap-5 lg:grid-cols-2">
        <Field
          label="原文预览与编辑"
          hint="生成分析最多取 20,000 字；超出时请缩短分析内容，不会自动截断。"
        >
          <textarea
            rows={17}
            maxLength={MAX_TEXT_LENGTH}
            disabled={busy}
            value={e.data.source || ""}
            onChange={(event) => e.patch("source", event.target.value)}
            placeholder="导入文件，或直接粘贴原文…"
          />
        </Field>
        <Field label="分析笔记">
          <textarea
            rows={17}
            maxLength={MAX_TEXT_LENGTH}
            disabled={busy}
            value={e.data.notes || ""}
            onChange={(event) => e.patch("notes", event.target.value)}
            placeholder="记录重点、疑问和自己的理解…"
          />
        </Field>
      </div>
    </Workspace>
  );
}
