import { useEffect, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import type { Entry } from "../../shared/types";
import { api, message } from "../lib/api";
import { Button, cn } from "./ui";
import { useI18n } from "../lib/i18n";

type ResourceEntry = Extract<Entry, { kind: "resources" }>;

/** 从选择器跳到资源库时留下的一次性标记，资源库页读到后显示「上传完再回来」的提示 */
export const PICK_INTENT_KEY = "aipharis:resource-pick-intent";

/** 能提取正文的格式，与后端 parseToText 保持一致 */
const TEXT_EXTRACTABLE = /\.(docx|xlsx|txt|md|markdown|csv|tsv|json|log)$/i;

const fmtSize = (n?: number) => {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

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
  onGoToResources,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (payload: { title: string; text: string }) => void | Promise<void>;
  /** 资源库为空时调用：把人直接送到资源库页面，而不是停在空弹窗上 */
  onGoToResources?: () => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<ResourceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [readingId, setReadingId] = useState("");
  const [error, setError] = useState("");

  /** 父级传的是内联箭头函数，放进依赖会让请求跟着每次渲染重跑，所以用 ref 固定 */
  const goToRef = useRef(onGoToResources);
  goToRef.current = onGoToResources;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    api<ResourceEntry[]>("/entries?kind=resources")
      .then((rows) => {
        setItems(rows);
        // 资源库是空的，留在这里只能看一句空提示 —— 直接过去上传
        if (rows.length === 0 && goToRef.current) {
          try {
            sessionStorage.setItem(PICK_INTENT_KEY, "1");
          } catch {
            // 存储不可用时只是少一条提示，不影响跳转
          }
          goToRef.current();
          onClose();
        }
      })
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  }, [open, onClose]);

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
        aria-label={t("pick.open")}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">{t("pick.title")}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {t("pick.hint")}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("pick.close")}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p className="p-6 text-center text-sm text-slate-500">{t("pick.loading")}</p>
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
                        {[item.data.ext?.replace(".", "").toUpperCase(), fmtSize(item.data.size)]
                          .filter(Boolean)
                          .join(" · ")}
                        {item.data.filename ? ` · ${item.data.filename}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {readingId === item.id ? t("pick.reading") : canRead ? t("pick.select") : t("pick.downloadOnly")}
                    </span>
                  </button>
                </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-8 text-center">
              <p className="text-sm text-slate-500">{t("pick.empty")}</p>
              <p className="mt-2 text-xs text-slate-400">
                先到左侧导航的「资源库」上传 Word / Excel / PDF 或文本文件，再回到这里选择。
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={onClose}>{t("pick.cancel")}</Button>
        </div>
      </div>
    </div>
  );
}
