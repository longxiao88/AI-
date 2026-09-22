import { Copy, Download, Sparkles } from "lucide-react";
import type { Mode } from "../../shared/types";
import { Button, Field, useConfirm } from "../components/ui";
import { Workspace } from "../components/Workspace";
import { modeNames } from "../config";
import { api, message } from "../lib/api";
import { useEditor, type ModuleProps } from "../lib/editor";
import { useBusy } from "../lib/useBusy";

export function Writing({ onDirty, onBusy, initialId }: ModuleProps) {
  const e = useEditor("writing", { mode: "compose", input: "", output: "" }, onDirty, initialId);
  const [busy, runAi] = useBusy(onBusy);
  const confirm = useConfirm();

  async function generate() {
    if (busy) return;
    if (!e.data.input?.trim()) return e.setError("请先输入写作要求或原文。");
    if (e.data.output && !(await confirm("重新生成会替换当前结果。确认继续吗？"))) return;

    e.setError("");
    e.setSuccess("");
    await runAi(async () => {
      try {
        const result = await api<{ output: string }>("/ai/generate", "POST", {
          input: e.data.input,
          mode: e.data.mode || "compose",
        });
        e.patch("output", result.output);
        e.setSuccess("生成完成，可编辑后保存。");
      } catch (err) {
        e.setError(message(err));
      }
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(e.data.output || "");
      e.setSuccess("已复制结果。");
    } catch {
      e.setError("复制失败，请手动选择结果文字复制。");
    }
  }

  function download() {
    // 文件名去掉 Windows 不允许的字符
    const url = URL.createObjectURL(
      new Blob([e.data.output || ""], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(e.title || "写作结果").replace(/[\\/:*?"<>|]/g, "_")}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Workspace editor={e} label="写作" busy={busy}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="grid content-start gap-5">
          <Field label="写作模式">
            <select
              disabled={busy}
              value={e.data.mode || "compose"}
              onChange={(event) => e.patch("mode", event.target.value as Mode)}
            >
              {Object.entries(modeNames).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={e.data.mode === "compose" ? "写作要求" : "原文"}
            hint="最多 20,000 字；生成内容请核对后使用。"
          >
            <textarea
              disabled={busy}
              maxLength={20000}
              rows={13}
              value={e.data.input || ""}
              onChange={(event) => e.patch("input", event.target.value)}
              placeholder={
                e.data.mode === "compose"
                  ? "例如：写一封项目进度邮件，说明已完成事项与下一步安排。"
                  : "粘贴需要处理的文字…"
              }
            />
          </Field>
          <Button variant="primary" disabled={busy || e.saving} onClick={() => void generate()}>
            <Sparkles size={16} />
            {busy ? "正在生成，请稍候…" : "开始生成"}
          </Button>
        </div>
        <div className="grid content-start gap-5">
          <div className="flex min-h-9 items-center justify-between">
            <h3 className="text-sm font-medium">写作结果</h3>
            <span className="text-xs text-slate-500">支持直接编辑</span>
          </div>
          <Field label="结果内容">
            <textarea
              aria-label="结果内容"
              rows={16}
              maxLength={50000}
              disabled={busy}
              value={e.data.output || ""}
              onChange={(event) => e.patch("output", event.target.value)}
              placeholder="生成结果会显示在这里，也可以先手动记录。"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!e.data.output || busy} onClick={() => void copy()}>
              <Copy size={15} />
              复制
            </Button>
            <Button disabled={!e.data.output || busy} onClick={download}>
              <Download size={15} />
              导出 TXT
            </Button>
          </div>
        </div>
      </div>
    </Workspace>
  );
}
