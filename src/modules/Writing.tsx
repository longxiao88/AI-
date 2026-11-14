import { useState } from "react";
import { BookOpen, Copy, Sparkles } from "lucide-react";
import type { Mode } from "../../shared/types";
import { Button, Field, Notice, useConfirm } from "../components/ui";
import { ExportMenu } from "../components/ExportMenu";
import { Workspace } from "../components/Workspace";
import { modeKeys } from "../config";
import { api, message } from "../lib/api";
import { useEditor, type ModuleProps } from "../lib/editor";
import { useI18n } from "../lib/i18n";
import { useBusy } from "../lib/useBusy";

export function Writing({ onDirty, onBusy, initialId }: ModuleProps) {
  const { t } = useI18n();
  const e = useEditor("writing", { mode: "compose", input: "", output: "" }, onDirty, initialId);
  const [busy, runAi] = useBusy(onBusy);
  const confirm = useConfirm();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  /** 把写作结果一键存为知识库条目，之后可参与检索问答。 */
  async function saveToKnowledge() {
    if (saving || busy) return;
    const content = (e.data.output || "").trim();
    if (!content) return e.setError(t("writing.emptyResult"));
    if (e.data.output && !(await confirm(t("writing.saveConfirm")))) return;

    setSaving(true);
    setSaveError("");
    e.setError("");
    try {
      await api(`/entries/knowledge`, "POST", {
        title: (e.title || t("writing.result")).trim() || t("writing.result"),
        data: { source: content, keywords: "" },
      });
      e.setSuccess(t("writing.savedToKb"));
    } catch (err) {
      setSaveError(message(err));
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    if (busy) return;
    if (!e.data.input?.trim()) return e.setError(t("writing.needInput"));
    if (e.data.output && !(await confirm(t("writing.regenConfirm")))) return;

    e.setError("");
    e.setSuccess("");
    await runAi(async () => {
      try {
        const result = await api<{ output: string }>("/ai/generate", "POST", {
          input: e.data.input,
          mode: e.data.mode || "compose",
        });
        e.patch("output", result.output);
        e.setSuccess(t("writing.generated"));
      } catch (err) {
        e.setError(message(err));
      }
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(e.data.output || "");
      e.setSuccess(t("writing.copied"));
    } catch {
      e.setError(t("writing.copyFail"));
    }
  }

  function download() {
    // 文件名去掉 Windows 不允许的字符
    const url = URL.createObjectURL(
      new Blob([e.data.output || ""], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(e.title || t("writing.result")).replace(/[\\/:*?"<>|]/g, "_")}.txt`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function downloadWord() {
    const content = (e.data.output || "").trim();
    if (!content) return;
    try {
      // 按需加载：docx 生成和 jszip 都只在这一次导出里用得上，不进首屏包
      const { exportDocx } = await import("../lib/docx");
      await exportDocx(content, e.title);
      e.setSuccess(t("writing.docxDone"));
    } catch {
      e.setError(t("writing.docxFail"));
    }
  }

  async function downloadPdf() {
    const content = (e.data.output || "").trim();
    if (!content) return;
    try {
      // 打印视图同样按需加载
      const { exportPdf } = await import("../lib/pdf");
      exportPdf(content, e.title);
      e.setSuccess(t("writing.pdfOpened"));
    } catch {
      e.setError(t("writing.pdfFail"));
    }
  }

  return (
    <Workspace editor={e} label={t("module.writing")} busy={busy}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="grid content-start gap-5">
          <Field label={t("writing.mode")}>
            <select
              disabled={busy}
              value={e.data.mode || "compose"}
              onChange={(event) => e.patch("mode", event.target.value as Mode)}
            >
              {Object.entries(modeKeys).map(([key, messageKey]) => (
                <option key={key} value={key}>
                  {t(messageKey)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={e.data.mode === "compose" ? t("writing.prompt") : t("writing.source")}
            hint={t("writing.limitHint")}
          >
            <textarea
              disabled={busy}
              maxLength={20000}
              rows={13}
              value={e.data.input || ""}
              onChange={(event) => e.patch("input", event.target.value)}
              placeholder={
                e.data.mode === "compose"
                  ? t("writing.promptPlaceholder")
                  : t("writing.sourcePlaceholder")
              }
            />
          </Field>
          <Button variant="primary" disabled={busy || e.saving} onClick={() => void generate()}>
            <Sparkles size={16} />
            {busy ? t("writing.generating") : t("writing.generate")}
          </Button>
        </div>
        <div className="grid content-start gap-5">
          <div className="flex min-h-9 items-center justify-between">
            <h3 className="text-sm font-medium">{t("writing.result")}</h3>
            <span className="text-xs text-slate-500">{t("writing.editable")}</span>
          </div>
          <Field label={t("writing.resultLabel")}>
            <textarea
              aria-label={t("writing.resultLabel")}
              rows={16}
              maxLength={50000}
              disabled={busy}
              value={e.data.output || ""}
              onChange={(event) => e.patch("output", event.target.value)}
              placeholder={t("writing.resultPlaceholder")}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!e.data.output || busy} onClick={() => void copy()}>
              <Copy size={15} />
              复制
            </Button>
            <ExportMenu
              disabled={!e.data.output || busy}
              onTxt={download}
              onDocx={() => void downloadWord()}
              onPdf={() => void downloadPdf()}
            />
            <Button
              disabled={!e.data.output || busy || saving}
              onClick={() => void saveToKnowledge()}
            >
              <BookOpen size={15} />
              {saving ? t("writing.savingToKb") : t("writing.saveToKb")}
            </Button>
          </div>
          <Notice error={saveError} />
        </div>
      </div>
    </Workspace>
  );
}
