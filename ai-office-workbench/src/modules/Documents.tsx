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
  const [pickerOpen, setPickerOpen] = useState(false);

  /** 从资源库选中文件后：正文填入「原文」，标题留空时沿用资源标题。 */
  async function pickFromResource(payload: { title: string; text: string }) {
    if (payload.text.length > MAX_TEXT_LENGTH) throw Error("文本不能超过 50,000 字，请先精简。");
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
    if (!source.trim()) return e.setError("请先导入或粘贴文档原文。");
    if (source.trim().length > AI_INPUT_LIMIT)
      return e.setError("文档原文超过 20,000 字，请缩短后再生成导图。");
    if (map && !(await confirm("重新生成会替换当前工程导图。确认继续吗？"))) return;

    e.setError("");
    e.setSuccess("");
    await runMap(async () => {
      try {
        const result = await api<MindmapResult>("/ai/mindmap", "POST", {
          title: e.title,
          source,
        });
        setMap(result);
        e.setSuccess("工程导图已生成，可导出为图片、矢量图或大纲。");
      } catch (err) {
        e.setError(message(err));
      }
    });
  }

  function safeName() {
    return (e.title || "工程导图").replace(/[\\/:*?"<>|]/g, "_");
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
        img.onerror = () => reject(new Error("图片生成失败"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, img.naturalWidth);
      canvas.height = Math.max(1, img.naturalHeight);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建画布");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((png) => {
        if (!png) return e.setError("导出图片失败，请改用 SVG 或大纲。");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(png);
        a.download = `${safeName()}.png`;
        a.click();
      }, "image/png");
    } catch {
      e.setError("导出 PNG 失败，请改用 SVG 或大纲。");
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
    <>
      <Workspace editor={e} label="文档" busy={busy}>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy || e.saving} onClick={() => void generate()}>
          <Sparkles size={16} />
          {busy ? "正在分析，请稍候…" : "生成分析草稿"}
        </Button>
        <Button disabled={busy || e.saving} onClick={() => void generateMap()}>
          <Network size={16} />
          {mapBusy ? "正在生成导图…" : "生成工程导图"}
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
        label="从资源库取原文"
        hint="选择已上传到资源库的文件，正文读出来填入下方原文；文件请到「资源库」上传。"
      >
        <Button
          onClick={() => setPickerOpen(true)}
          disabled={busy}
          className="inline-flex w-fit items-center gap-2"
        >
          <FolderOpen size={16} />
          从资源库选择文件
        </Button>
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

      {map && (
        <div className="grid gap-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">工程导图（未保存，可直接导出）</h3>
            <span className="text-xs text-slate-500">从原文提炼的需求结构，导出后不会写入本页</span>
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
      />
    </>
  );
}
