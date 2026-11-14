import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import type { Entry } from "../../shared/types";
import { api, message } from "../lib/api";
import { formatFileSize } from "../lib/format";
import { Button, cn } from "./ui";

type ResourceEntry = Extract<Entry, { kind: "resources" }>;

/** 能提取正文的格式，与后端 parseToText 保持一致 */
const TEXT_EXTRACTABLE = /\.(docx|xlsx|txt|md|markdown|csv|tsv|json|log)$/i;

/**
 * 从资源库挑一个文件，把正文取出来交给调用方。
 *
 * 知识库与文档分析都走这里，不再各自接收本地文件——
 * 上传只发生在资源库一处，避免「同一个文件有三个入口、三种结果」。
 */
export function ResourcePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (payload: { title: string; text: string }) => void | Promise<void>;
}) {
  const [items, setItems] = useState<ResourceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [readingId, setReadingId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    api<ResourceEntry[]>("/entries?kind=resources")
      .then(setItems)
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function pick(item: ResourceEntry) {
    if (readingId) return;
    setReadingId(item.id);
    setError("");
    try {
      const data = await api<{ title: string; text: string }>(`/resources/${item.id}/text`);
      await onPick({ title: data.title, text: data.text });
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setReadingId("");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      onClick={onClose}
    >
      <div
        className="panel flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden p-5"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="从资源库选择文件"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">从资源库选择</h2>
            <p className="mt-1 text-xs text-slate-500">
              只读取文件正文，不会复制或改动资源本身。PDF 与图片无法提取正文，需到「资源库」预览或下载。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p className="p-6 text-center text-sm text-slate-500">正在读取资源库…</p>
          ) : items.length ? (
            <ul className="grid gap-2">
              {items.map((item) => {
                const canRead = TEXT_EXTRACTABLE.test(item.data.ext || "");
                return (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={!canRead || !!readingId}
                    onClick={() => void pick(item)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left transition",
                      canRead && "hover:border-blue-300 hover:bg-blue-50",
                      !canRead && "cursor-not-allowed opacity-60",
                      readingId === item.id && "border-blue-400 bg-blue-50",
                      readingId && readingId !== item.id && "opacity-50",
                    )}
                  >
                    <FileText size={18} className="shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {[item.data.ext?.replace(".", "").toUpperCase(), formatFileSize(item.data.size)]
                          .filter(Boolean)
                          .join(" · ")}
                        {item.data.filename ? ` · ${item.data.filename}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {readingId === item.id ? "读取中…" : canRead ? "选择" : "仅可下载"}
                    </span>
                  </button>
                </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-8 text-center">
              <p className="text-sm text-slate-500">资源库还没有文件。</p>
              <p className="mt-2 text-xs text-slate-400">
                先到左侧导航的「资源库」上传 Word / Excel / PDF 或文本文件，再回到这里选择。
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={onClose}>取消</Button>
        </div>
      </div>
    </div>
  );
}
