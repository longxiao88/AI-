import { useMemo } from "react";
import type { MindmapNode } from "../../shared/ai-schemas";
import {
  layoutMindmap,
  MINDMAP_FONT_SIZE,
  MINDMAP_LINE_H,
  MINDMAP_PAD_Y,
  type MindmapBox,
} from "../lib/mindmap";

/**
 * 纯 SVG 渲染的树状工程导图。布局计算全部在 src/lib/mindmap.ts（可单测），
 * 本组件只负责把布局结果画出来，支持点击节点切换选中。
 * 不引入任何第三方图表库。
 */
export function MindmapSvg({
  root,
  selectedId,
  onSelect,
}: {
  root: MindmapNode;
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const layout = useMemo(() => layoutMindmap(root), [root]);

  // 为每个节点分配稳定 id（按遍历顺序）
  const ids = useMemo(() => {
    const map = new Map<MindmapBox, string>();
    layout.boxes.forEach((n, i) => map.set(n, `mm-${i}`));
    return map;
  }, [layout]);

  return (
    <svg
      viewBox={`0 0 ${Math.round(layout.width)} ${Math.round(layout.height)}`}
      className="mx-auto block h-full max-h-[560px] w-full"
      role="img"
      aria-label="工程导图"
      xmlns="http://www.w3.org/2000/svg"
    >
      {layout.boxes.map((n) =>
        n.children.map((child) => {
          const x1 = n.x + n.w;
          const y1 = n.y + n.h / 2;
          const x2 = child.x;
          const y2 = child.y + child.h / 2;
          const midX = (x1 + x2) / 2;
          return (
            <path
              key={`${ids.get(n)}-${ids.get(child)}`}
              d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="#cbd5e1"
              strokeWidth="1.5"
            />
          );
        }),
      )}
      {layout.boxes.map((n) => {
        const id = ids.get(n)!;
        const isRoot = n.depth === 0;
        const selected = selectedId === id;
        const fill = isRoot
          ? "#2563eb"
          : selected
            ? "#dbeafe"
            : n.depth === 1
              ? "#eff6ff"
              : "#ffffff";
        const stroke = isRoot
          ? "#2563eb"
          : selected
            ? "#3b82f6"
            : n.depth === 1
              ? "#bfdbfe"
              : "#e2e8f0";
        return (
          <g
            key={id}
            transform={`translate(${n.x},${n.y})`}
            onClick={() => onSelect?.(id)}
            style={{ cursor: "pointer" }}
          >
            <rect width={n.w} height={n.h} rx="9" fill={fill} stroke={stroke} strokeWidth={isRoot ? 0 : 1.5} />
            {n.lines.map((line, i) => (
              <text
                key={i}
                x={n.w / 2}
                y={MINDMAP_PAD_Y + i * MINDMAP_LINE_H + MINDMAP_LINE_H / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={MINDMAP_FONT_SIZE}
                fill={isRoot ? "#ffffff" : n.depth === 1 ? "#1e40af" : "#334155"}
                fontWeight={isRoot ? 600 : 400}
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
