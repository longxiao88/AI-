import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronUp, Search as SearchIcon } from "lucide-react";
import type { Entry } from "../../shared/types";
import { Notice } from "../components/ui";
import { navigation, navTitleKey, type Page } from "../config";
import { api, message } from "../lib/api";
import { useI18n, type Translate } from "../lib/i18n";

/* 正十二面体带 three.js（gzip 约 150KB），不该进首屏包。
   用 lazy 拆成独立 chunk，只有真的打开搜索页才去加载。 */
const WordDodecahedron = lazy(() =>
  import("../components/WordDodecahedron").then((m) => ({ default: m.WordDodecahedron })),
);

const kindLabel = (kind: Entry["kind"], t: Translate) => {
  const hit = navigation.find((n) => n.id === kind);
  return hit ? t(navTitleKey(hit.id)) : kind;
};

/** 全局搜索要跨模块聚合正文，这里按「所有模块可能出现文本字段」取值 */
type SearchableText = Partial<
  Record<"source" | "notes" | "summary" | "todos" | "description" | "input" | "output" | "keywords", string>
>;

/** 可匹配的全文：标题 + 正文。 */
function entryText(entry: Entry): string {
  const d = entry.data as SearchableText;
  return [entry.title, d.source, d.notes, d.summary, d.todos, d.description, d.input, d.output]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

/** 摘要只用正文，不含标题 —— 否则命中词在标题里时，摘要会把标题原样重复一遍。 */
function bodyText(entry: Entry): string {
  const d = entry.data as SearchableText;
  return [d.summary, d.notes, d.description, d.input, d.output, d.todos, d.source]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 命中词前后各留一段上下文；没命中正文就取开头。 */
function snippet(entry: Entry, q: string): string {
  const body = bodyText(entry);
  if (!body) return "";
  const idx = q ? body.toLowerCase().indexOf(q) : -1;
  if (idx < 0) return body.slice(0, 64);
  const start = Math.max(0, idx - 26);
  return (start > 0 ? "…" : "") + body.slice(start, idx + q.length + 40);
}

function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return { day: `${d.getMonth() + 1}月${d.getDate()}日`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** 把命中的词标出来。用 React 节点而不是 innerHTML。 */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q || !text) return <>{text}</>;
  const lower = text.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  for (;;) {
    const at = lower.indexOf(q, i);
    if (at < 0) {
      out.push(text.slice(i));
      break;
    }
    if (at > i) out.push(text.slice(i, at));
    out.push(<mark key={`${at}-${q}`}>{text.slice(at, at + q.length)}</mark>);
    i = at + q.length;
  }
  return <>{out}</>;
}

export function Search({
  navigate,
}: {
  navigate: (page: Page, id?: string) => void;
}) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | Entry["kind"]>("all");
  const [current, setCurrent] = useState<Entry | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* 节点锚点：组件按每帧写的 transform 把入口放到转向的那个顶点右边 */
  const nodeAnchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /* 单条窗口：滚轮在这一格上翻记录 */
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Entry[]>("/entries")
      .then(setEntries)
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  }, []);

  /* 搜索框右侧那个 ⌘K 是真的能用的：全站任意位置按下就聚焦并全选，
     再按一次 Esc 退出。没有这条，那枚 kbd 就是一句假话。 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = query.trim().toLowerCase();

  const matched = useMemo(
    () =>
      q
        ? entries
            .filter((entry) => entryText(entry).includes(q))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        : [],
    [entries, q],
  );

  /** 没输入关键词时按时间排全库 —— 空着一栏比空着整页更难看。 */
  const byTime = useMemo(
    () => [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [entries],
  );

  /* 有查询就看命中，没查询就看全库。分布计数永远从同一份数据算，
     所以列表和数字不会打架。 */
  const pool = q ? matched : byTime;
  const dist = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of pool) map.set(e.kind, (map.get(e.kind) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [pool]);

  const scoped = scope === "all" ? pool : pool.filter((e) => e.kind === scope);
  /* 结果只有「一栏」：一个 72px 的窗口，一次露一条，其余靠滚轮翻。 */
  const shown = useMemo(() => scoped, [scoped]);
  const at = Math.max(0, current ? shown.findIndex((e) => e.id === current.id) : -1);
  /* 没有选中过就露第一条；点开与翻条都以这条为准 */
  const active = current && at >= 0 ? current : (shown[0] ?? null);

  /* 点一条就打开它 —— 右边没有详情面板了，再让点击只「选中」就是点了个寂寞。 */
  const open = (entry: Entry) => navigate(entry.kind, entry.id);

  /* 翻一条：到头再翻就绕回去，像卷轴一样不至于顶死在一端 */
  const step = (dir: 1 | -1) => {
    if (!shown.length) return;
    const next = shown[(at + dir + shown.length) % shown.length];
    setCurrent(next);
  };

  /* 滚轮翻条。React 的 onWheel 是 passive 的，preventDefault 不生效，
     所以自己挂一个 passive:false 的监听；180ms 的节流挡住触控板的一串小 delta。 */
  useEffect(() => {
    const el = slotRef.current;
    if (!el || shown.length < 2) return;
    let acc = 0;
    let last = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const now = performance.now();
      acc += event.deltaY;
      if (Math.abs(acc) < 24 || now - last < 180) return;
      last = now;
      step(acc > 0 ? 1 : -1);
      acc = 0;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const pickScope = (next: "all" | Entry["kind"]) => {
    setScope(next);
    // 换了来源，节点上挂的那条不能还是被筛掉的
    const list = next === "all" ? pool : pool.filter((e) => e.kind === next);
    setCurrent((prev) => (prev && list.some((e) => e.id === prev.id) ? prev : (list[0] ?? null)));
  };

  const shortcut =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";

  const lastQ = useRef("");
  useEffect(() => {
    if (!q) {
      // 没搜索时节点上没有入口，标题留给「拖拽旋转」那只角标
      lastQ.current = "";
      setCurrent(null);
      return;
    }
    if (!matched.length) {
      setCurrent(null);
      return;
    }
    setCurrent((prev) => (prev && matched.some((m) => m.id === prev.id) ? prev : matched[0]));
    if (lastQ.current !== q) {
      lastQ.current = q;
      setFocusToken((n) => n + 1);
    }
  }, [q, matched]);

  return (
    <div className="search-page">
      <div className="search-board">
        <section className="search-panel">
            {/* 搜索框放进结果面板：合并成一个盒子，省下的高度留给左下角的装置 */}
            <div className="search-field">
              <SearchIcon size={17} />
              <input
                ref={inputRef}
                value={query}
                maxLength={500}
                autoFocus
                aria-label={t("search.keywords")}
                aria-keyshortcuts="Control+K Meta+K"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setScope("all");
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    step(event.key === "ArrowDown" ? 1 : -1);
                    return;
                  }
                  if (event.key === "Enter" && current) {
                    event.preventDefault();
                    open(current);
                    return;
                  }
                  if (event.key === "Escape" && query) {
                    setQuery("");
                    setScope("all");
                  }
                }}
                placeholder={t("search.placeholder")}
              />
              <kbd aria-hidden="true">{shortcut}</kbd>
            </div>
            <Notice error={error} />

            {/* 计数、来源、第几条 —— 一行说完，剩下的整块留给当前这一条 */}
            <div className="search-meta">
              <span className="search-count" aria-live="polite">
                {loading ? t("search.loading") : shown.length ? t("search.hits", { n: shown.length }) : t("search.noMatch")}
              </span>
              {dist.length > 1 ? (
                <div className="search-chips" role="group" aria-label={t("search.filter")}>
                  <button type="button" aria-pressed={scope === "all"} onClick={() => pickScope("all")}>
                    全部 <em>{pool.length}</em>
                  </button>
                  {dist.map(([kind, count]) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={scope === kind}
                      onClick={() => pickScope(kind as Entry["kind"])}
                    >
                      {kindLabel(kind as Entry["kind"], t)} <em>{count}</em>
                    </button>
                  ))}
                </div>
              ) : null}
              <span className="search-pager">
                <button type="button" aria-label={t("search.prev")} onClick={() => step(-1)} disabled={shown.length < 2}>
                  <ChevronUp size={14} aria-hidden="true" />
                </button>
                <em>{shown.length ? `${at + 1} / ${shown.length}` : "0 / 0"}</em>
                <button type="button" aria-label={t("search.next")} onClick={() => step(1)} disabled={shown.length < 2}>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </span>
            </div>

            {/* 只有一栏：一次露一条完整记录，滚轮在它上面翻下一条。
                标题给到 26px —— 数据稀疏时，这一块得撑得住整个版面。 */}
            <div className="search-slot" ref={slotRef}>
              {loading ? (
                <div className="record is-loading" aria-hidden="true">
                  <span className="sk-title" />
                  <span className="sk-snip" />
                </div>
              ) : !active ? (
                <p className="search-empty">
                  <b>{t("search.count", { n: 0 })}</b>
                  <span>{t("search.emptyFor", { q: query.trim() })}</span>
                </p>
              ) : (
                <button key={active.id} type="button" className="record" onClick={() => open(active)}>
                  <span className="record-head">
                    <span className="record-kind">{kindLabel(active.kind, t)}</span>
                    <span className="record-when">
                      {when(active.updatedAt).day} {when(active.updatedAt).time}
                    </span>
                  </span>
                  <span className="record-title">
                    <Highlight text={active.title} q={q} />
                  </span>
                  {snippet(active, q) ? (
                    <span className="record-snip">
                      <Highlight text={snippet(active, q)} q={q} />
                    </span>
                  ) : null}
                  <span className="record-open">
                    打开
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </span>
                </button>
              )}
            </div>
        </section>

        {/* 左下角：装置本体。画布透明，直接浮在页面背景上 */}
        <div className="search-device">
          {/* 玻璃底板：白天海面太亮，十二面体的青色线会飘在浪花里；
              垫一块方形玻璃，装置就有了自己的场，又不会像贴上去的卡片。 */}
          <span className="device-plate" aria-hidden="true" />

            <Suspense fallback={<div className="dodeca-loading">{t("search.loadingScene")}</div>}>
              <WordDodecahedron focusToken={focusToken} anchorRef={nodeAnchorRef} />
            </Suspense>

          {/* 唯一一条「查看」入口：长在装置转向的那个节点右边。
              位置由组件逐帧写进 transform，这里只提供形状和内容。 */}
          {current && q ? (
            <div className="node-anchor" ref={nodeAnchorRef}>
              {/* 不套卡片：这一页漂在画布上的东西只该有一种 —— 节点的名字。
                  盒子会把它变成一张贴纸，也让标题和右侧面板重复一次。 */}
              {/* 上面那张卡已经写着标题了，这里不再重复一遍：
                  节点旁边只需要一个「查看」，指回当前这条记录。 */}
              <button
                type="button"
                className="node-entry"
                aria-label={`查看记录：${current.title}`}
                onClick={() => open(current)}
              >
                查看
                <ArrowUpRight size={12} aria-hidden="true" />
              </button>
            </div>
          ) : null}

        </div>

      </div>
    </div>
  );
}
