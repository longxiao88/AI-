import { useEffect, useRef, useState } from "react";
import { Send, Copy, Download, MessageSquare, Plus, Save } from "lucide-react";
import { chatInputSchema, type ChatMessage } from "../../shared/chat";
import { api, message } from "../lib/api";
import { isPreview } from "../lib/runtime";
import { useI18n } from "../lib/i18n";
import { Button, Field, Notice, useConfirm } from "../components/ui";

export function Chat({
  onDirty,
  onBusy,
}: {
  onDirty: (v: boolean) => void;
  onBusy: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  // 有输入或已有对话时，切换页面前提醒
  useEffect(() => {
    onDirty(!!input || messages.length > 0);
  }, [input, messages, onDirty]);

  const transcript = messages
    .map((m) => `${m.role === "user" ? t("chat.me") : "AI"}：\n${m.content}`)
    .join("\n\n");

  /** 把当前对话存为一条知识库条目，方便之后检索回溯。 */
  async function saveTranscript() {
    if (saving || busy) return;
    if (!messages.length) return setError(t("chat.nothingToSave"));
    if (!(await confirm(t("chat.saveConfirm")))) return;

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api(`/entries/knowledge`, "POST", {
        title: `问答 ${new Date().toLocaleDateString("zh-CN")}`,
        data: { source: transcript, keywords: t("chat.record") },
      });
      setSuccess(t("chat.saved"));
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  /** 把整段对话发给后端；失败时保留已有对话和本次输入，不自动重试。 */
  async function send() {
    if (pending.current || !input.trim() || isPreview) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: input.trim() }];
    const parsed = chatInputSchema.safeParse({ messages: next });
    if (!parsed.success) {
      setError(
        t("chat.limit"),
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await api<{ answer: string }>("/ai/chat", "POST", parsed.data);
      setMessages([...next, { role: "assistant", content: result.answer }]);
      setInput("");
      setSuccess(t("chat.done"));
    } catch (e) {
      setError(message(e));
    } finally {
      pending.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  async function reset() {
    if (
      (messages.length || input) &&
      !(await confirm(t("chat.resetConfirm")))
    )
      return;
    setMessages([]);
    setInput("");
    setError("");
    setSuccess("");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(transcript);
      setSuccess(t("chat.copied"));
    } catch {
      setError(t("chat.clipboardFail"));
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([transcript], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = t("chat.exportFile");
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSuccess(t("chat.exported"));
  }

  return (
    <section className="panel grid min-w-0 gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare size={20} />
          <h2 className="font-semibold">{t("chat.heading")}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !messages.length} onClick={() => void copy()}>
            <Copy size={15} />
            {t("chat.copyConv")}
          </Button>
          <Button disabled={busy || !messages.length} onClick={download}>
            <Download size={15} />
            {t("chat.exportTxt")}
          </Button>
          <Button disabled={busy || saving || !messages.length} onClick={() => void saveTranscript()}>
            <Save size={15} />
            {saving ? t("chat.saving") : t("chat.save")}
          </Button>
          <Button disabled={busy} onClick={() => void reset()}>
            <Plus size={15} />
            {t("chat.newConv")}
          </Button>
        </div>
      </div>
      <p className="text-sm text-slate-500">
        {t("chat.intro")}
      </p>
      {isPreview && (
        <p className="rounded-xl border border-blue-200 p-4 text-sm">
          这是界面演示，可试填问题。真实问答请运行源码版，在设置中连接自己的 AI 服务。
        </p>
      )}
      <Notice error={error} success={success} />
      <div role="log" aria-label={t("chat.record")} aria-live="polite" className="grid min-w-0 gap-4">
        {!messages.length && (
          <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
            {t("chat.starter")}
          </div>
        )}
        {messages.map((m, i) => (
          <article key={i} className="min-w-0 rounded-xl border border-slate-200 p-4">
            <h3 className="mb-2 text-sm font-semibold">{m.role === "user" ? t("chat.me") : t("chat.assistant")}</h3>
            <div className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">
              {m.content}
            </div>
          </article>
        ))}
      </div>
      <Field label={t("chat.questionLabel")} hint={t("chat.inputHint")}>
        <textarea
          rows={4}
          maxLength={20000}
          value={input}
          disabled={busy}
          placeholder={t("chat.placeholder")}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-slate-500">
          {messages.length / 2} / 20 轮 · {input.length.toLocaleString()} / 20,000 字
        </span>
        <Button
          variant="primary"
          disabled={busy || !input.trim() || isPreview}
          onClick={() => void send()}
        >
          <Send size={15} />
          {busy ? t("chat.answering") : t("chat.send")}
        </Button>
      </div>
    </section>
  );
}
