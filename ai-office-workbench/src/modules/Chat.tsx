import { useEffect, useRef, useState } from "react";
import { Send, Copy, Download, MessageSquare, Plus, Save } from "lucide-react";
import { chatInputSchema, type ChatMessage } from "../../shared/chat";
import { api, message } from "../lib/api";
import { isPreview } from "../lib/runtime";
import { Button, Field, Notice, useConfirm } from "../components/ui";

export function Chat({
  onDirty,
  onBusy,
}: {
  onDirty: (v: boolean) => void;
  onBusy: (v: boolean) => void;
}) {
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
    .map((m) => `${m.role === "user" ? "我" : "AI"}：\n${m.content}`)
    .join("\n\n");

  /** 把当前对话存为一条知识库条目，方便之后检索回溯。 */
  async function saveTranscript() {
    if (saving || busy) return;
    if (!messages.length) return setError("当前没有对话内容可保存。");
    if (!(await confirm("确认把整段对话保存为一条知识库条目吗？"))) return;

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api(`/entries/knowledge`, "POST", {
        title: `问答 ${new Date().toLocaleDateString("zh-CN")}`,
        data: { source: transcript, keywords: "问答记录" },
      });
      setSuccess("对话已存入知识库。");
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
        "本次对话已达到长度或20轮上限，请导出后开始新对话；单次提问最多20,000字，总上下文最多40,000字。",
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
      setSuccess("回答已完成，可以继续追问。");
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
      !(await confirm("开始新对话会清空当前内容，请先复制或导出需要保留的对话。确认继续吗？"))
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
      setSuccess("对话已复制。");
    } catch {
      setError("无法访问剪贴板，请使用导出 TXT。");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([transcript], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "AI问答.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSuccess("对话已导出。");
  }

  return (
    <section className="panel grid min-w-0 gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare size={20} />
          <h2 className="font-semibold">和 AI 聊一聊</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !messages.length} onClick={() => void copy()}>
            <Copy size={15} />
            复制对话
          </Button>
          <Button disabled={busy || !messages.length} onClick={download}>
            <Download size={15} />
            导出 TXT
          </Button>
          <Button disabled={busy || saving || !messages.length} onClick={() => void saveTranscript()}>
            <Save size={15} />
            {saving ? "保存中…" : "存入知识库"}
          </Button>
          <Button disabled={busy} onClick={() => void reset()}>
            <Plus size={15} />
            新对话
          </Button>
        </div>
      </div>
      <p className="text-sm text-slate-500">
        可连续追问，最多20轮。对话仅保留在当前页面，离开或刷新前请导出。回答不自动读取知识库。
      </p>
      {isPreview && (
        <p className="rounded-xl border border-blue-200 p-4 text-sm">
          这是界面演示，可试填问题。真实问答请运行源码版，在设置中连接自己的 AI 服务。
        </p>
      )}
      <Notice error={error} success={success} />
      <div role="log" aria-label="问答记录" aria-live="polite" className="grid min-w-0 gap-4">
        {!messages.length && (
          <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
            从一个问题开始，例如：如何安排一次高效的项目例会？
          </div>
        )}
        {messages.map((m, i) => (
          <article key={i} className="min-w-0 rounded-xl border border-slate-200 p-4">
            <h3 className="mb-2 text-sm font-semibold">{m.role === "user" ? "我" : "AI 助手"}</h3>
            <div className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">
              {m.content}
            </div>
          </article>
        ))}
      </div>
      <Field label="你的问题" hint="Enter 换行，Ctrl / ⌘ + Enter 发送。">
        <textarea
          rows={4}
          maxLength={20000}
          value={input}
          disabled={busy}
          placeholder="输入问题，或继续追问…"
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
          {busy ? "正在回答…" : "发送问题"}
        </Button>
      </div>
    </section>
  );
}
