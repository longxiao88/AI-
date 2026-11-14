import { useEffect, useState } from "react";
import { Download, FileImage, FileCode, FileText, FolderOpen, Network, Sparkles } from "lucide-react";
import {
  AI_INPUT_LIMIT,
  type DocumentResult,
  type MindmapResult,
  type MindmapNode,
} from "../../shared/ai-schemas";
import { ResourcePicker } from "../components/ResourcePicker";
import { Button, Field, useConfirm } from "../components/ui";
import { MindmapSvg } from "../components/Mindmap";
import { mindmapSvgMarkup } from "../lib/mindmap";
import { Workspace } from "../components/Workspace";
import { api, message } from "../lib/api";
import { useEditor, type ModuleProps } from "../lib/editor";
import { useBusy } from "../lib/useBusy";
import { useI18n, type Translate } from "../lib/i18n";

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

const numbered = (items: string[], t: Translate) =>
  items.length ? items.map((v, i) => `${i + 1}. ${v}`) : [t("documents.missing")];

/** 把草稿拼成带小标题的笔记正文 */
function draftToNotes(draft: Draft, t: Translate) {
  return [
    t("documents.kOverview"),
    draft.overview.trim(),
    "",
    t("documents.kPoints"),
    ...numbered(toLines(draft.keyPoints), t),
    "",
    t("documents.kActions"),
    ...numbered(toLines(draft.actions), t),
  ].join("\n");
}

export function Documents({ onDirty, onBusy, initialId, goTo }: ModuleProps) {
  const { t } = useI18n();
  const e = useEditor("documents", { source: "", notes: "" }, onDirty, initialId);
  const [busy, runAi] = useBusy(onBusy);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  /** 从资源库选中文件后：正文填入「原文」，标题留空时沿用资源标题。 */
  async function pickFromResource(payload: { title: string; text: string }) {
    if (payload.text.length > MAX_TEXT_LENGTH) throw Error(t("documents.tooLongText"));
    e.patch("source", payload.text);
    if (!e.title) e.setTitle(payload.title.slice(0, 120));
    e.setSuccess(
      `已读取「${payload.title}」共 ${payload.text.length.toLocaleString("zh-CN")} 字，请分析或保存。`,
    );
  }
  const [map, setMap] = useState<MindmapResult | null>(null);
  const [mapBusy, runMap] = useBusy(onBusy);
  const confirm = useConfirm();

  const currentId = e.current?.id;
  useEffect(() => {
    setDraft(null);
    setMap(null);
  }, [currentId]);

  /** 从原文生成工程导图草稿，可导出、可放弃，不自动入库。 */
  async function generateMap() {
    if (busy) return;
    const source = e.data.source || "";
    if (!source.trim()) return e.setError(t("documents.needSource"));
    if (source.trim().length > AI_INPUT_LIMIT)
      return e.setError(t("documents.tooLongMap"));
    if (map && !(await confirm(t("documents.regenMapConfirm")))) return;

    e.setError("");
    e.setSuccess("");
    await runMap(async () => {
      try {
        const result = await api<MindmapResult>("/ai/mindmap", "POST", {
          title: e.title,
          source,
        });
        setMap(result);
        e.setSuccess(t("documents.mapReady"));
      } catch (err) {
        e.setError(message(err));
      }
    });
  }

  function safeName() {
    return (e.title || t("documents.map")).replace(/[\\/:*?"<>|]/g, "_");
  }

  function downloadBlob(content: BlobPart, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSvg() {
    if (!map) return;
    downloadBlob(mindmapSvgMarkup(map.root), `${safeName()}.svg`, "image/svg+xml;charset=utf-8");
  }

  async function exportPng() {
    if (!map) return;
    try {
      // 按 2 倍固有尺寸栅格化：SVG 自带 width/height，图片加载后即为清晰的目标尺寸
      const svg = mindmapSvgMarkup(map.root, { scale: 2 });
      const img = new Image();
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error(t("documents.imageFail")));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, img.naturalWidth);
      canvas.height = Math.max(1, img.naturalHeight);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error(t("documents.canvasFail"));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((png) => {
        if (!png) return e.setError(t("documents.imageExportFail"));
        const a = document.createElement("a");
        a.href = URL.createObjectURL(png);
        a.download = `${safeName()}.png`;
        a.click();
      }, "image/png");
    } catch {
      e.setError(t("documents.pngFail"));
    }
  }

  /** 树状结构转 Markdown 缩进大纲，可导入幕布 / Obsidian / XMind。 */
  function nodeToMd(node: MindmapNode, depth: number): string {
    const indent = "  ".repeat(depth);
    return `${indent}- ${node.text}\n${node.children
      .map((c) => nodeToMd(c, depth + 1))
      .join("")}`;
  }

  function exportMd() {
    if (!map) return;
    downloadBlob(
      `# ${map.title}\n\n${nodeToMd(map.root, 0)}`,
      `${safeName()}.md`,
      "text/markdown;charset=utf-8",
    );
  }

  async function generate() {
    if (busy) return;
    const source = e.data.source || "";
    if (!source.trim()) return e.setError(t("documents.needSource"));
    if (source.trim().length > AI_INPUT_LIMIT)
      return e.setError(t("documents.tooLongAnalysis"));
    if (draft && !(await confirm(t("documents.regenConfirm")))) return;

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
        e.setSuccess(t("documents.draftReady"));
      } catch (err) {
        e.setError(message(err));
      }
    });
  }

  async function apply() {
    if (!draft) return;
    if (e.data.notes && !(await confirm(t("documents.applyConfirm")))) return;
    e.patch("notes", draftToNotes(draft, t));
    setDraft(null);
    e.setSuccess(t("documents.applied"));
  }

  function discard() {
    setDraft(null);
    e.setSuccess(t("documents.discarded"));
  }

  return (
    <>
      <Workspace editor={e} label={t("module.documents")} busy={busy}>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy || e.saving} onClick={() => void generate()}>
          <Sparkles size={16} />
          {busy ? t("documents.analyzing") : t("documents.generate")}
        </Button>
        <Button disabled={busy || e.saving} onClick={() => void generateMap()}>
          <Network size={16} />
          {mapBusy ? t("documents.mapping") : t("documents.generateMap")}
        </Button>
        <span className="text-xs text-slate-500">{t("documents.genHint")}</span>
      </div>

      {draft && (
        <div className="grid gap-5 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t("documents.draftTitle")}</h3>
            <span className="text-xs text-slate-500">{t("documents.draftEditable")}</span>
          </div>
          <Field label={t("documents.draftOverview")}>
            <textarea
              rows={5}
              maxLength={10000}
              value={draft.overview}
              onChange={(event) => setDraft({ ...draft, overview: event.target.value })}
            />
          </Field>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label={t("documents.draftPoints")} hint={t("documents.onePerLine")}>
              <textarea
                rows={6}
                maxLength={20000}
                value={draft.keyPoints}
                onChange={(event) => setDraft({ ...draft, keyPoints: event.target.value })}
              />
            </Field>
            <Field label={t("documents.draftActions")} hint={t("documents.onePerLine")}>
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
            <Button onClick={discard}>{t("documents.discard")}</Button>
          </div>
        </div>
      )}

      <Field
        label={t("documents.fromResource")}
        hint={t("documents.pickHint")}
      >
        <Button
          onClick={() => setPickerOpen(true)}
          disabled={busy}
          className="inline-flex w-fit items-center gap-2"
        >
          <FolderOpen size={16} />
          {t("pick.open")}
        </Button>
      </Field>
      <div className="grid gap-5 lg:grid-cols-2">
        <Field
          label={t("documents.sourcePanel")}
          hint={t("documents.limitHint")}
        >
          <textarea
            rows={17}
            maxLength={MAX_TEXT_LENGTH}
            disabled={busy}
            value={e.data.source || ""}
            onChange={(event) => e.patch("source", event.target.value)}
            placeholder={t("documents.sourcePlaceholder")}
          />
        </Field>
        <Field label={t("documents.notes")}>
          <textarea
            rows={17}
            maxLength={MAX_TEXT_LENGTH}
            disabled={busy}
            value={e.data.notes || ""}
            onChange={(event) => e.patch("notes", event.target.value)}
            placeholder={t("documents.notesPlaceholder")}
          />
        </Field>
      </div>

      {map && (
        <div className="grid gap-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t("documents.mapUnsaved")}</h3>
            <span className="text-xs text-slate-500">{t("documents.mapHint")}</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3">
            <MindmapSvg root={map.root} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void exportPng()}>
              <FileImage size={15} />
              导出 PNG
            </Button>
            <Button onClick={exportSvg}>
              <FileCode size={15} />
              导出 SVG
            </Button>
            <Button onClick={exportMd}>
              <FileText size={15} />
              导出大纲
            </Button>
            <Button onClick={() => setMap(null)}>
              <Download size={15} />
              放弃导图
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            导图为 AI 从原文提炼的草稿，仅供整理思路；重要内容请以原文为准，导出的大纲可导入幕布、Obsidian 或 XMind 继续编辑。
          </p>
        </div>
      )}
      </Workspace>
      <ResourcePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={pickFromResource}
        onGoToResources={() => goTo?.("resources")}
      />
    </>
  );
}
