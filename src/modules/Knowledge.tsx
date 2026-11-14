import { useState } from "react";
import { BookOpen, FileUp, FolderOpen, Search, Sparkles } from "lucide-react";
import type { KnowledgeHit } from "../../shared/types";
import { ResourcePicker } from "../components/ResourcePicker";
import { Button, Empty, Field, Notice } from "../components/ui";
import { Workspace } from "../components/Workspace";
import { api, message } from "../lib/api";
import { useEditor, type ModuleProps } from "../lib/editor";
import { isPreview } from "../lib/runtime";
import { useBusy } from "../lib/useBusy";
import { useI18n } from "../lib/i18n";

export function Knowledge({ onDirty, onBusy, initialId, goTo }: ModuleProps) {
  const { t } = useI18n();
  const e = useEditor("knowledge", { source: "", keywords: "" }, onDirty, initialId);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null);
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<KnowledgeHit[]>([]);
  const [busy, run] = useBusy(onBusy);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  /** 从资源库选中文件后：正文填入表单，标题沿用资源标题，关键词保持用户已有内容。 */
  async function pickFromResource(payload: { title: string; text: string }) {
    const ok = await e.select(null);
    if (!ok) return;
    e.setTitle(payload.title.slice(0, 120));
    e.patch("source", payload.text);
    e.setSuccess(
      `已读取「${payload.title}」共 ${payload.text.length.toLocaleString("zh-CN")} 字，请核对后保存。`,
    );
  }

  /** 先做关键词检索；withAi 为 true 时再把命中的资料交给模型整理答案。 */
  async function search(withAi = false) {
    if (busy || !query.trim()) return;
    setError("");
    setAnswer("");
    setSources([]);
    await run(async () => {
      try {
        const found = await api<KnowledgeHit[]>(`/knowledge/search?q=${encodeURIComponent(query)}`);
        setHits(found);
        if (!withAi) return;
        if (!found.length) throw Error(t("knowledge.notFound"));

        const result = await api<{ answer: string; sources: KnowledgeHit[] }>(
          "/ai/knowledge",
          "POST",
          { question: query },
        );
        setAnswer(result.answer);
        setSources(result.sources);
      } catch (err) {
        setError(message(err));
      }
    });
  }

  return (
    <div className="grid gap-6">
      <section className="panel p-5 sm:p-6">
        <div className="mb-5 flex items-center gap-3">
          <BookOpen size={22} />
          <div>
            <h2 className="font-semibold">{t("knowledge.heading")}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {t("knowledge.searchHint")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <Field label={t("knowledge.questionLabel")}>
              <input
                value={query}
                maxLength={500}
                disabled={busy}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setAnswer("");
                  setSources([]);
                  setHits(null);
                }}
                placeholder={t("knowledge.questionPlaceholder")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void search();
                }}
              />
            </Field>
          </div>
          <Button disabled={busy || !query.trim()} onClick={() => void search()}>
            <Search size={16} />
            {t("knowledge.search")}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !query.trim()}
            onClick={() => void search(true)}
          >
            <Sparkles size={16} />
            {busy ? t("knowledge.processing") : t("knowledge.aiAnswer")}
          </Button>
        </div>
        {isPreview && (
          <p className="mt-3 text-xs text-slate-500">
            演示模式支持关键词检索；AI 整理需在本机完整版配置模型后使用。
          </p>
        )}
        <div className="mt-4 grid gap-4">
          <Notice error={error} />
          {hits?.length === 0 && <Empty text={t("knowledge.noMatchHint")} />}
          {!!hits?.length && (
            <div className="grid gap-3 md:grid-cols-2">
              {hits.map((hit, i) => (
                <article key={hit.id} className="search-hit">
                  <span className="eyebrow">SOURCE {String(i + 1).padStart(2, "0")}</span>
                  <h3>{hit.title}</h3>
                  <p>{hit.excerpt}</p>
                  <Button
                    className="mt-3"
                    onClick={() => {
                      const record = e.items.find((item) => item.id === hit.id);
                      if (record) void e.select(record);
                    }}
                  >
                    打开原文
                  </Button>
                </article>
              ))}
            </div>
          )}
          {answer && (
            <div className="knowledge-answer">
              <h3>{t("knowledge.aiResult")}</h3>
              <p>{answer}</p>
              <h4>{t("knowledge.sources")}</h4>
              {sources.map((s, i) => (
                <p key={s.id} className="text-sm">
                  [{i + 1}] {s.title}
                </p>
              ))}
            </div>
          )}
        </div>
      </section>
      <section className="panel p-5 sm:p-6">
        <div className="mb-5 flex items-center gap-3">
          <FileUp size={22} />
          <div>
            <h2 className="font-semibold">{t("knowledge.fromResource")}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {t("knowledge.pickHint")}
            </p>
          </div>
        </div>
        <Button
          onClick={() => setPickerOpen(true)}
          disabled={busy}
          className="inline-flex items-center gap-2"
        >
          <FolderOpen size={16} />
          {t("pick.open")}
        </Button>
        <p className="mt-3 text-xs text-slate-500">
          文件统一在「资源库」上传（Word / Excel / PDF / 文本 / 图片）。这里只读取正文，不复制、不改动资源本身；
          导入内容会先填入表单，确认后才写入知识库。
        </p>
      </section>
      <Workspace editor={e} label={t("knowledge.entry")} busy={busy}>
        <Field label={t("knowledge.keywordsLabel")} hint={t("knowledge.keywordHint")}>
          <input
            maxLength={500}
            value={e.data.keywords || ""}
            onChange={(event) => e.patch("keywords", event.target.value)}
            placeholder={t("knowledge.tagPlaceholder")}
          />
        </Field>
        <Field label={t("knowledge.body")}>
          <textarea
            rows={10}
            maxLength={50000}
            value={e.data.source || ""}
            onChange={(event) => e.patch("source", event.target.value)}
            placeholder={t("knowledge.bodyPlaceholder")}
          />
        </Field>
      </Workspace>
      <ResourcePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={pickFromResource}
        onGoToResources={() => goTo?.("resources")}
      />
    </div>
  );
}
