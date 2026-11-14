import { useEffect, useRef, useState } from "react";
import {
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  FileUp,
  FolderOpen,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { UPLOAD } from "../../shared/constants";
import type { Entry } from "../../shared/types";

/** 资源库页面的记录一定是 resources 类型，用判别联合的子集避免每处都判断 kind */
type ResourceEntry = Extract<Entry, { kind: "resources" }>;
import { Button, Empty, Field, Notice, cn, useConfirm } from "../components/ui";
import { api, message } from "../lib/api";
import { formatFileSize } from "../lib/format";
import type { ModuleProps } from "../lib/editor";
import { useBusy } from "../lib/useBusy";

const CATEGORIES = ["文档", "表格", "其他"];

/** 允许上传的文件扩展名 */
const UPLOAD_EXT = /\.(docx|xlsx|txt|md|markdown|csv|pdf|pptx|png|jpg|jpeg|gif|zip)$/i;
/** 能在线预览的格式，与后端 PREVIEWABLE 保持一致；zip、PDF、图片只能下载 */
const PREVIEWABLE = /\.(docx|xlsx|txt|md|markdown|csv)$/i;
const MAX_UPLOAD = UPLOAD.maxBytes;

interface PreviewResult {
  type: "html" | "sheets" | "text";
  html?: string;
  text?: string;
  sheets?: { name: string; rows: string[][] }[];
}

interface AnalysisResult {
  overview: string;
  keyPoints: string[];
  actions: string[];
}

const catIcon = (ext?: string) => {
  const e = (ext || "").toLowerCase();
  if (e === ".xlsx" || e === ".csv") return FileSpreadsheet;
  if (e === ".docx" || e === ".txt" || e === ".md" || e === ".markdown") return FileText;
  return FileUp;
};

export function Resources({ onBusy }: Pick<ModuleProps, "onBusy">) {
  const [items, setItems] = useState<ResourceEntry[]>([]);
  const [current, setCurrent] = useState<ResourceEntry | null>(null);
  const [filter, setFilter] = useState<string>("全部");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // 上传
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [upTitle, setUpTitle] = useState("");
  const [upCategory, setUpCategory] = useState("文档");
  const fileInput = useRef<HTMLInputElement>(null);

  // 预览 / AI 分析
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [aiBusy, runAi] = useBusy(onBusy);
  const confirm = useConfirm();

  async function loadList() {
    setLoading(true);
    try {
      const rows = await api<ResourceEntry[]>("/entries?kind=resources");
      setItems(rows);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadList();
  }, []);

  useEffect(() => {
    setPreview(null);
    setAnalysis(null);
  }, [current?.id]);

  const cats = ["全部", ...Array.from(new Set(items.map((i) => i.data.category || "未分类")))];
  const filtered = filter === "全部" ? items : items.filter((i) => (i.data.category || "未分类") === filter);

  async function uploadFiles(files: FileList | File[]) {
    if (uploading) return;
    const list = Array.from(files).filter((f) => UPLOAD_EXT.test(f.name));
    if (!list.length) {
      setError("不支持该文件类型，请上传 .docx / .xlsx / .pdf / 文本 / 图片或 .zip 压缩包。");
      return;
    }
    setError("");
    setSuccess("");
    setUploading(true);
    const zipNotes: string[] = [];
    try {
      for (const file of list) {
        if (file.size > MAX_UPLOAD) throw Error(`「${file.name}」超过 50 MB，请压缩后重试。`);
        const fd = new FormData();
        fd.append("file", file);
        fd.append("title", upTitle.trim() || file.name.replace(/\.[^.]+$/, ""));
        fd.append("category", upCategory);
        const res = await fetch("/api/resources/upload", { method: "POST", body: fd });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw Error(body.error || "上传失败，请重试。");
        // 压缩包返回 { entries, zipId, extracted, skipped, truncated }
        if (body.zipId) {
          const skip = body.skipped ? `，跳过 ${body.skipped} 个不支持的条目` : "";
          const cut = body.truncated ? "（已达上限，其余未处理）" : "";
          zipNotes.push(
            body.extracted
              ? `「${file.name}」已保存原件，并解压出 ${body.extracted} 个文件${skip}${cut}`
              : `「${file.name}」已保存原件，但没有可解压的文件${skip}`,
          );
        }
      }
      await loadList();
      const plain = list.length - zipNotes.length;
      const parts = [
        ...(plain > 0 ? [`已上传 ${plain} 个文件`] : []),
        ...zipNotes,
      ];
      setSuccess(`${parts.join("；") || "上传完成"}。`);
      setUpTitle("");
      fileInput.current && (fileInput.current.value = "");
    } catch (e) {
      setError(message(e));
    } finally {
      setUploading(false);
      setDragging(false);
    }
  }

  async function openPreview(item: ResourceEntry) {
    if (!item.data.storedName) return;
    setPreview(null);
    setPreviewBusy(true);
    setError("");
    try {
      setPreview(await api<PreviewResult>(`/resources/${item.id}/preview`));
    } catch (e) {
      setError(message(e));
    } finally {
      setPreviewBusy(false);
    }
  }

  function download(item: ResourceEntry) {
    // 直接跳转到下载接口（浏览器会按 Content-Disposition 保存）
    const a = document.createElement("a");
    a.href = `/api/resources/${item.id}/download`;
    a.download = item.data.filename || item.title;
    a.click();
  }

  async function analyze(item: ResourceEntry) {
    if (!item.data.storedName) return;
    setError("");
    setAnalysis(null);
    await runAi(async () => {
      try {
        setAnalysis(await api<AnalysisResult>(`/resources/${item.id}/analyze`, "POST", {}));
      } catch (e) {
        setError(message(e));
      }
    });
  }

  async function remove(item: ResourceEntry) {
    if (!(await confirm("删除该资源会同时删除磁盘上的文件，且无法恢复。确认删除吗？"))) return;
    try {
      await api(`/entries/${item.id}`, "DELETE");
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      if (current?.id === item.id) setCurrent(null);
      setSuccess("资源已删除。");
    } catch (e) {
      setError(message(e));
    }
  }

  const Icon = current ? catIcon(current.data.ext) : FolderOpen;

  return (
    <div className="grid gap-6">
      {/* 上传区 */}
      <section className="panel p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <FileUp size={22} />
          <div>
            <h2 className="font-semibold">上传资源</h2>
            <p className="mt-1 text-sm text-slate-500">
              上传 Word、Excel、PDF、文本或 .zip 压缩包；压缩包会保留原件并自动解压成多个文件。文件可在线预览、下载，并用 AI 快速理解内容。
            </p>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <Field label="资源标题" hint="留空则使用文件名。">
              <input
                value={upTitle}
                maxLength={120}
                disabled={uploading}
                onChange={(e) => setUpTitle(e.target.value)}
                placeholder="例如：季度经营分析报告"
              />
            </Field>
          </div>
          <div className="w-32">
            <Field label="分类">
              <select
                value={upCategory}
                disabled={uploading}
                onChange={(e) => setUpCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        <div
          role="button"
          tabIndex={0}
          aria-label="拖拽或点击上传文件"
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInput.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            void uploadFiles(e.dataTransfer.files);
          }}
          className={cn(
            "grid cursor-pointer place-items-center gap-2 rounded-xl border border-dashed p-8 text-center transition-colors",
            dragging
              ? "border-blue-400 bg-blue-50"
              : "border-slate-300 hover:border-blue-300 hover:bg-slate-50",
          )}
        >
          <UploadCloud size={32} className={dragging ? "text-blue-500" : "text-slate-400"} />
          <p className="text-sm font-medium text-slate-700">
            {uploading ? "正在上传…" : dragging ? "松开鼠标上传" : "拖拽文件到此处，或点击选择"}
          </p>
          <p className="text-xs text-slate-500">
            支持 .docx、.xlsx、.pdf、.txt、.md、图片与 .zip 压缩包，单个不超过 50 MB
          </p>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".docx,.xlsx,.txt,.md,.markdown,.csv,.pdf,.pptx,.png,.jpg,.jpeg,.gif,.zip"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void uploadFiles(e.target.files);
            }}
          />
        </div>
      </section>

      <Notice error={error} success={success} />

      {/* 资源列表 + 详情 */}
      <div className="grid items-start gap-5 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="panel overflow-hidden">
          <div className="border-b border-slate-100 p-4">
            <h2 className="text-sm font-semibold">我的资源（{items.length}）</h2>
            <div className="mt-3 flex flex-wrap gap-1">
              {cats.map((c) => (
                <button
                  key={c}
                  onClick={() => setFilter(c)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs transition-colors",
                    filter === c ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-96 overflow-auto p-2 xl:max-h-[36rem]">
            {loading ? (
              <p className="p-4 text-sm text-slate-500">正在读取…</p>
            ) : filtered.length ? (
              filtered.map((item) => {
                const I = catIcon(item.data.ext);
                return (
                  <button
                    key={item.id}
                    onClick={() => setCurrent(item)}
                    className={cn(
                      "mb-1 block w-full rounded-lg p-3 text-left hover:bg-slate-50",
                      current?.id === item.id && "bg-blue-50 text-blue-700",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <I size={15} className="shrink-0" />
                      <span className="truncate">{item.title}</span>
                    </span>
                    <span className="mt-1 block text-xs text-slate-500 tabular-nums">
                      {item.data.category || "未分类"} · {formatFileSize(item.data.size)}
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="p-4 text-sm leading-6 text-slate-500">
                还没有上传的资源。<br />
                在上方拖入或选择文件即可开始。
              </p>
            )}
          </div>
        </aside>

        <section className="panel min-w-0 p-5 sm:p-6">
          {!current ? (
            <Empty text="从左侧选择一个资源，或在上方上传新文件。" />
          ) : (
            <div className="grid gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Icon size={22} />
                  <div>
                    <h2 className="font-semibold">{current.title}</h2>
                    <p className="text-xs text-slate-500">
                      {current.data.filename} · {formatFileSize(current.data.size)} · 下载{" "}
                      {current.data.downloads || 0} 次
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void openPreview(current)}
                    disabled={previewBusy || !PREVIEWABLE.test(current.data.ext || "")}
                    title={
                      PREVIEWABLE.test(current.data.ext || "")
                        ? undefined
                        : "该格式不支持在线预览，请下载后查看"
                    }
                  >
                    <Eye size={15} />
                    {previewBusy
                      ? "解析中…"
                      : PREVIEWABLE.test(current.data.ext || "")
                        ? "在线预览"
                        : "不支持预览"}
                  </Button>
                  <Button onClick={() => download(current)}>
                    <Download size={15} />
                    下载
                  </Button>
                  <Button
                    variant="primary"
                    disabled={aiBusy}
                    onClick={() => void analyze(current)}
                  >
                    <Sparkles size={15} />
                    {aiBusy ? "分析中…" : "AI 分析"}
                  </Button>
                  <Button variant="danger" onClick={() => void remove(current)}>
                    删除
                  </Button>
                </div>
              </div>

              {/* AI 分析结果 */}
              {analysis && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
                  <h3 className="text-sm font-medium">AI 分析结果</h3>
                  <div className="mt-3 grid gap-4 text-sm">
                    <div>
                      <p className="font-medium text-slate-700">概述</p>
                      <p className="mt-1 whitespace-pre-wrap text-slate-600">{analysis.overview}</p>
                    </div>
                    <div>
                      <p className="font-medium text-slate-700">关键要点</p>
                      <ul className="mt-1 list-decimal space-y-1 pl-5 text-slate-600">
                        {analysis.keyPoints.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium text-slate-700">建议行动</p>
                      <ul className="mt-1 list-decimal space-y-1 pl-5 text-slate-600">
                        {analysis.actions.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* 预览区 */}
              {preview?.type === "html" && (
                <div
                  className="preview-doc rounded-xl border border-slate-200 bg-white p-5"
                  dangerouslySetInnerHTML={{ __html: preview.html || "" }}
                />
              )}
              {preview?.type === "text" && (
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
                  {preview.text}
                </pre>
              )}
              {preview?.type === "sheets" &&
                preview.sheets?.map((sheet, si) => (
                  <div key={si} className="grid gap-2">
                    <h4 className="text-sm font-medium">{sheet.name}</h4>
                    <div className="max-h-96 overflow-auto rounded-xl border border-slate-200">
                      <table className="w-full border-collapse text-xs">
                        <tbody>
                          {sheet.rows.map((row, ri) => (
                            <tr key={ri} className={ri === 0 ? "bg-slate-100 font-medium" : "odd:bg-white even:bg-slate-50"}>
                              {row.map((cell, ci) => (
                                <td key={ci} className="border border-slate-200 px-2 py-1 whitespace-nowrap">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
