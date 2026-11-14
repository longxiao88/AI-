import { useEffect, useState } from "react";
import { ArrowUpRight, Search as SearchIcon } from "lucide-react";
import type { Entry } from "../../shared/types";
import { Empty, Field, Notice } from "../components/ui";
import { navigation, type Page } from "../config";
import { api, message } from "../lib/api";

const kindLabel = (kind: Entry["kind"]) =>
  navigation.find((n) => n.id === kind)?.title || kind;

/** 全局搜索要跨模块聚合正文，这里按「所有模块可能出现文本字段」取值 */
type SearchableText = Partial<
  Record<"source" | "notes" | "summary" | "todos" | "description" | "input" | "output" | "keywords", string>
>;

/** 把一条记录的可检索文本聚合起来，供关键词匹配。 */
function entryText(entry: Entry): string {
  const d = entry.data as SearchableText;
  return [entry.title, d.source, d.notes, d.summary, d.todos, d.description, d.input, d.output]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

/** 摘出命中的片段，命中词前后各保留一点上下文。 */
function snippet(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, 80);
  return text.slice(Math.max(0, idx - 30), idx + query.length + 50);
}

export function Search({
  navigate,
}: {
  navigate: (page: Page, id?: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Entry[]>("/entries")
      .then(setEntries)
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  }, []);

  const q = query.trim().toLowerCase();
  const results = q
    ? entries
        .filter((entry) => entryText(entry).includes(q))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    : [];

  return (
    <div className="grid gap-6">
      <section className="panel p-5 sm:p-6">
        <div className="mb-5 flex items-center gap-3">
          <SearchIcon size={22} />
          <div>
            <h2 className="font-semibold">搜索整个工作空间</h2>
            <p className="mt-1 text-sm text-slate-500">
              一次查找写作、会议、项目、文档与知识库中的全部内容。
            </p>
          </div>
        </div>
        <Field label="关键词">
          <input
            value={query}
            maxLength={500}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入要查找的内容，例如：交付、预算、客户…"
          />
        </Field>
        <Notice error={error} />
        <div className="mt-4 grid gap-3">
          {loading ? (
            <p className="p-4 text-sm text-slate-500">正在读取记录…</p>
          ) : q ? (
            results.length ? (
              <>
                <p className="text-sm text-slate-500">
                  找到 {results.length} 条相关记录，按最近更新排序。
                </p>
                {results.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.kind, item.id)}
                    className="search-hit flex w-full items-start justify-between gap-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="eyebrow">{kindLabel(item.kind)}</span>
                      <h3 className="mt-1">{item.title}</h3>
                      <p className="mt-1 line-clamp-2">{snippet(entryText(item), q)}</p>
                    </span>
                    <ArrowUpRight size={17} className="mt-1 shrink-0 text-slate-400" />
                  </button>
                ))}
              </>
            ) : (
              <Empty text="没有找到相关记录，换一个关键词试试。" />
            )
          ) : (
            <p className="p-4 text-sm text-slate-500">
              输入关键词开始搜索，共 {entries.length} 条记录可查。
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
