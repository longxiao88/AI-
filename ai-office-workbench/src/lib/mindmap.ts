import type { MindmapNode } from "../../shared/ai-schemas";

/**
 * 工程导图布局与导出（纯函数，无 React / DOM 依赖，可被单元测试直接验证）。
 *
 * 布局采用「层级列 + 叶子堆叠」：
 * - 每个深度占一列，列宽 = 该层最宽节点的实际内容宽度，从结构上杜绝层间节点互相遮挡；
 * - 叶子自上而下堆叠，父节点在首尾子节点的垂直中线居中；
 * - 画布尺寸由内容决定，不再留大片空白。
 */

const FONT_SIZE = 13;
const LINE_H = 19;
const PAD_X = 15;
const PAD_Y = 8;
const MAX_TEXT_W = 190; // 超过此宽度的文本自动换行
const COL_GAP = 64; // 相邻层级列之间的水平间距
const SIB_GAP = 16; // 同一列内相邻子树之间的垂直间距

// 供 React 渲染组件复用，保证页面展示与导出文件完全一致
export const MINDMAP_FONT_SIZE = FONT_SIZE;
export const MINDMAP_LINE_H = LINE_H;
export const MINDMAP_PAD_Y = PAD_Y;

export interface MindmapBox {
  node: MindmapNode;
  depth: number;
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  children: MindmapBox[];
}

interface MindmapLayout {
  root: MindmapBox;
  /** 全部节点，父节点在前（浅层先绘制，深层不会盖住浅层文字）。 */
  boxes: MindmapBox[];
  width: number;
  height: number;
}

/** 估算文本宽度：CJK 字符按 1 个字宽，ASCII 按 0.66（略保守，防止文字溢出框）。 */
function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += ch.charCodeAt(0) > 0xff ? FONT_SIZE : FONT_SIZE * 0.66;
  return width;
}

/** 按像素宽度贪心换行（导图标签以中文为主，逐字换行即可接受）。 */
function wrapText(text: string): string[] {
  const trimmed = text.trim();
  if (textWidth(trimmed) <= MAX_TEXT_W) return [trimmed || " "];
  const lines: string[] = [];
  let current = "";
  let width = 0;
  for (const ch of trimmed) {
    const w = ch.charCodeAt(0) > 0xff ? FONT_SIZE : FONT_SIZE * 0.66;
    if (current && width + w > MAX_TEXT_W) {
      lines.push(current);
      current = ch;
      width = w;
    } else {
      current += ch;
      width += w;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [" "];
}

/** 计算整棵树的布局：节点框位置、画布宽高。 */
export function layoutMindmap(root: MindmapNode): MindmapLayout {
  const colMaxW: number[] = [];

  // 第一遍：测量每个节点（宽度按内容、高度按行数），并记录每层最大宽度。
  function measureTree(node: MindmapNode, depth: number): MindmapBox {
    const lines = wrapText(node.text);
    const w = Math.ceil(Math.max(...lines.map(textWidth))) + PAD_X * 2;
    const h = lines.length * LINE_H + PAD_Y * 2;
    colMaxW[depth] = Math.max(colMaxW[depth] ?? 0, w);
    const box: MindmapBox = { node, depth, lines, x: 0, y: 0, w, h, children: [] };
    box.children = node.children.map((child) => measureTree(child, depth + 1));
    return box;
  }

  const laidRoot = measureTree(root, 0);

  // 每层一列：列 x = 前面各层最大宽度之和 + 间距，层间永不重叠。
  const colX: number[] = [];
  let acc = 0;
  for (let depth = 0; depth < colMaxW.length; depth++) {
    colX[depth] = acc;
    acc += colMaxW[depth] + COL_GAP;
  }
  const width = acc - COL_GAP;

  // 第二遍：叶子自上而下堆叠，父节点相对子节点居中；
  // floorAtDepth 记录同层已占用的底部，防止父节点居中时撞上上一棵子树。
  let cursor = 0;
  const floorAtDepth: number[] = [];

  function place(box: MindmapBox) {
    box.x = colX[box.depth];
    if (!box.children.length) {
      box.y = cursor;
      cursor += box.h + SIB_GAP;
    } else {
      box.children.forEach(place);
      const first = box.children[0];
      const last = box.children[box.children.length - 1];
      const centered = (first.y + (last.y + last.h)) / 2 - box.h / 2;
      box.y = Math.max(centered, floorAtDepth[box.depth] ?? Number.NEGATIVE_INFINITY);
    }
    floorAtDepth[box.depth] = box.y + box.h + SIB_GAP;
  }

  place(laidRoot);

  const boxes: MindmapBox[] = [];
  const collect = (box: MindmapBox) => {
    boxes.push(box);
    box.children.forEach(collect);
  };
  collect(laidRoot);

  const height = Math.max(cursor - SIB_GAP, laidRoot.h);
  return { root: laidRoot, boxes, width, height };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 生成独立可下载的 SVG 文档字符串。
 * 显式写入 width / height（Firefox 加载 SVG 图片需要固有尺寸），viewBox 保持逻辑坐标。
 * options.scale 用于 PNG 导出时按 2 倍固有尺寸栅格化，保证清晰度。
 */
export function mindmapSvgMarkup(root: MindmapNode, options?: { scale?: number }): string {
  const scale = Math.max(1, options?.scale ?? 1);
  const { boxes, width, height } = layoutMindmap(root);
  const w = Math.round(width);
  const h = Math.round(height);

  const edges = boxes
    .flatMap((n) =>
      n.children.map((child) => {
        const x1 = n.x + n.w;
        const y1 = n.y + n.h / 2;
        const x2 = child.x;
        const y2 = child.y + child.h / 2;
        const midX = (x1 + x2) / 2;
        return `<path d="M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" fill="none" stroke="#cbd5e1" stroke-width="1.5"/>`;
      }),
    )
    .join("");

  const nodes = boxes
    .map((n) => {
      const isRoot = n.depth === 0;
      const fill = isRoot ? "#2563eb" : n.depth === 1 ? "#eff6ff" : "#ffffff";
      const stroke = isRoot ? "#2563eb" : n.depth === 1 ? "#bfdbfe" : "#e2e8f0";
      const textColor = isRoot ? "#ffffff" : n.depth === 1 ? "#1e40af" : "#334155";
      const texts = n.lines
        .map(
          (line, i) =>
            `<text x="${n.w / 2}" y="${PAD_Y + i * LINE_H + LINE_H / 2}" text-anchor="middle" dominant-baseline="central" font-size="${FONT_SIZE}" fill="${textColor}" font-weight="${
              isRoot ? 600 : 400
            }" font-family="system-ui, 'Microsoft YaHei', sans-serif">${escapeXml(line)}</text>`,
        )
        .join("");
      return `<g transform="translate(${n.x},${n.y})"><rect width="${n.w}" height="${n.h}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="${
        isRoot ? 0 : 1.5
      }"/>${texts}</g>`;
    })
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="#ffffff"/>`,
    edges,
    nodes,
    "</svg>",
  ].join("");
}
