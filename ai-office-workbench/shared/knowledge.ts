import type { Entry, KnowledgeHit } from "./types";

const MAX_HITS = 5;
const EXCERPT_LENGTH = 900;

/**
 * 简单的关键词检索：标签命中权重最高，其次是标题，正文最低。
 * 中文没有空格分词，额外把连续汉字切成两字一组参与匹配。
 */
export function searchKnowledge(entries: Entry[], query: string): KnowledgeHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const words = q.split(/[\s，,。？！?!、;；]+/).filter(Boolean);
  const bigrams = (q.match(/[\p{Script=Han}]+/gu) || []).flatMap((part) =>
    Array.from({ length: Math.max(0, part.length - 1) }, (_, i) => part.slice(i, i + 2)),
  );
  const terms = [...new Set([...words, ...bigrams])];

  return entries
    .filter((e) => e.kind === "knowledge")
    .map((e) => {
      const source = e.data.source || "";
      const title = e.title.toLowerCase();
      const tags = (e.data.keywords || "").toLowerCase();
      const body = source.toLowerCase();

      let score = 0;
      for (const t of terms) {
        if (tags.includes(t)) score += 8;
        if (title.includes(t)) score += 5;
        if (body.includes(t)) score += 1;
      }

      // 摘录从第一个命中词前面一点开始截取
      const first = terms.find((t) => body.includes(t));
      const start = Math.max(0, (first ? body.indexOf(first) : 0) - 50);
      return {
        id: e.id,
        title: e.title,
        score,
        excerpt: source.slice(start, start + EXCERPT_LENGTH),
      };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_HITS);
}
