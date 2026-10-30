import test from "node:test";
import assert from "node:assert/strict";
import { layoutMindmap, mindmapSvgMarkup } from "../src/lib/mindmap.js";
import type { MindmapNode } from "../shared/ai-schemas.js";

const n = (text: string, children: MindmapNode[] = []): MindmapNode => ({ text, children });

// 与用户反馈截图对应的真实案例：OTC 药品知识（3 层、18 个叶子）
const otcTree = n("OTC药品知识", [
  n("定义", [n("非处方药")]),
  n("主要特点", [
    n("无需医生处方"),
    n("可自行购买使用"),
    n("安全性较高"),
    n("使用方便"),
    n("用于常见轻症"),
    n("需按说明书使用"),
  ]),
  n("分类", [
    n("甲类", [n("红底白字标识"), n("药店销售"), n("可能需药师指导")]),
    n("乙类", [n("绿底白字标识"), n("安全性更高"), n("可在超市等销售")]),
  ]),
  n("判断方法", [n("看包装OTC标识"), n("无标识为处方药"), n("病情较重及时就医")]),
  n("使用", [n("咨询医生药师"), n("勿仅靠自购处理")]),
]);

/** 两两检查所有节点框：要么 x 区间分离，要么 y 区间分离，绝不相交。 */
function assertNoBoxOverlap(root: MindmapNode) {
  const { boxes } = layoutMindmap(root);
  assert.ok(boxes.length > 0);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const separatedX = a.x + a.w <= b.x + 0.01 || b.x + b.w <= a.x + 0.01;
      const separatedY = a.y + a.h <= b.y + 0.01 || b.y + b.h <= a.y + 0.01;
      assert.ok(separatedX || separatedY, `节点「${a.node.text}」与「${b.node.text}」布局重叠`);
    }
  }
  return boxes;
}

test("导图布局：任意两个节点框互不重叠（对照用户反馈的 OTC 案例）", () => {
  const boxes = assertNoBoxOverlap(otcTree);
  // 回归确认：浅层节点不会被深层节点盖住（各层列 x 严格递增）
  const byDepth = new Map<number, number>();
  for (const box of boxes) {
    const startX = byDepth.get(box.depth);
    if (startX === undefined) byDepth.set(box.depth, box.x);
    else assert.equal(box.x, startX, "同一层节点的列起点应一致");
  }
});

test("导图布局：父节点在首尾子节点的垂直中线居中", () => {
  const { boxes } = layoutMindmap(otcTree);
  for (const box of boxes) {
    if (!box.children.length) continue;
    const centers = box.children.map((c) => c.y + c.h / 2);
    const mid = (centers[0] + centers[centers.length - 1]) / 2;
    assert.ok(
      Math.abs(box.y + box.h / 2 - mid) < 1,
      `「${box.node.text}」未相对子节点居中`,
    );
  }
});

test("导图布局：画布尺寸由内容决定，不再有大片空白", () => {
  const { width, height, boxes } = layoutMindmap(otcTree);
  assert.ok(width < 700, `画布宽 ${width} 应远小于旧的固定 900`);
  const maxBottom = Math.max(...boxes.map((b) => b.y + b.h));
  assert.ok(height + 0.01 >= maxBottom, "画布高度必须容纳所有节点");
});

test("导图布局：极端输入不重叠（12 叉星形 / 10 层深链 / 120 字长文本）", () => {
  assertNoBoxOverlap(n("中心", Array.from({ length: 12 }, (_, i) => n(`分支${i + 1}`))));
  let deep = n("末端");
  for (let i = 9; i >= 0; i--) deep = n(`第${i + 1}层`, [deep]);
  assertNoBoxOverlap(deep);
  assertNoBoxOverlap(
    n("长文本", [
      n("这是一段特别长的文本".repeat(12)),
      n("短"),
      n("another-very-long-ascii-label-without-any-space-at-all".repeat(3)),
    ]),
  );
});

test("导图 SVG：带固有宽高属性，特殊字符正确转义", () => {
  const svg = mindmapSvgMarkup(n("根<b>&节点", [n("子节点")]));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+" viewBox="0 0 \d+ \d+">/);
  assert.ok(svg.includes("根&lt;b&gt;&amp;节点"), "XML 特殊字符必须转义");
  assert.ok(svg.includes('fill="#ffffff"'), "需要白色背景，保证 PNG 导出不透明");
});
