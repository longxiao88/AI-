import { parseBlocks, type Block } from "./docx";

/**
 * 导出 PDF 走浏览器打印，而不是用 jsPDF 之类的库。
 *
 * 原因：中文 PDF 必须内嵌字体，一套中文字体动辄几 MB，子集化又要额外的
 * 排版引擎；而浏览器打印出来的 PDF 本来就是矢量的、文字可选中可搜索，
 * 中文字体直接用系统的。代价只是多一个「另存为 PDF」的系统对话框，
 * GitHub、Notion 这些产品的「导出 PDF」也是这么做的。
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

const esc = (text: string) => text.replace(/[&<>"']/g, (char) => ESCAPES[char]);

/** 内容里的标题整体降一级：h1 留给文档标题，正文从 h2 起 */
function blockToHtml(block: Block): string {
  switch (block.kind) {
    case "blank":
      return "";
    case "h1":
      return `<h2>${esc(block.text)}</h2>`;
    case "h2":
      return `<h3>${esc(block.text)}</h3>`;
    case "h3":
      return `<h4>${esc(block.text)}</h4>`;
    case "li":
      return `<p class="li">· ${esc(block.text)}</p>`;
    case "quote":
      return `<blockquote>${esc(block.text)}</blockquote>`;
    case "code":
      return `<pre>${esc(block.text)}</pre>`;
    default:
      return `<p>${esc(block.text)}</p>`;
  }
}

const PRINT_CSS = `
@page { size: A4; margin: 20mm 18mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  font-family: "宋体", "Songti SC", "SimSun", serif;
  font-size: 12pt;
  line-height: 1.75;
  color: #000;
}
h1 {
  font-family: "黑体", "Heiti SC", "SimHei", sans-serif;
  font-size: 19pt;
  line-height: 1.4;
  margin: 0 0 16pt;
  padding-bottom: 8pt;
  border-bottom: 0.5pt solid #999;
}
h2, h3, h4 {
  font-family: "黑体", "Heiti SC", "SimHei", sans-serif;
  line-height: 1.45;
  margin: 16pt 0 8pt;
  page-break-after: avoid;
}
h2 { font-size: 15pt; }
h3 { font-size: 13.5pt; }
h4 { font-size: 12.5pt; }
p { margin: 0 0 6pt; text-indent: 2em; }
p.li { text-indent: 0; margin-left: 2em; }
blockquote {
  margin: 6pt 0 6pt 1.5em;
  padding-left: 10pt;
  border-left: 2pt solid #ccc;
  color: #444;
  font-style: italic;
  text-indent: 0;
}
blockquote { text-indent: 0; }
pre {
  font-family: "Consolas", "Courier New", monospace;
  font-size: 10pt;
  line-height: 1.5;
  background: #f5f5f5;
  padding: 8pt 10pt;
  margin: 6pt 0;
  white-space: pre-wrap;
  word-break: break-word;
}
`;

/**
 * 用隐藏 iframe 承载打印视图再调起系统打印。
 * iframe 放在视口外而不是 `visibility:hidden` —— 后者在部分浏览器会打印出空白页。
 */
export function buildPrintHtml(text: string, title: string) {
  const blocks = parseBlocks(text);

  let start = 0;
  while (start < blocks.length && blocks[start].kind === "blank") start += 1;
  const lead = blocks[start];

  const docTitle = title.trim() || (lead?.kind === "h1" ? lead.text.trim() : "写作结果");
  // 正文第一行标题与文档标题重复时跳过，避免同一个标题印两遍
  const skipLead = lead?.kind === "h1" && lead.text.trim() === docTitle;
  const body = (skipLead ? blocks.slice(start + 1) : blocks).map(blockToHtml).join("");

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(docTitle)}</title>
<style>${PRINT_CSS}</style></head>
<body><h1>${esc(docTitle)}</h1>${body}</body></html>`;
}

/** 用隐藏 iframe 承载打印视图再调起系统打印 */
export function exportPdf(text: string, title: string) {
  const html = buildPrintHtml(text, title);

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;";

  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const run = () => {
    win.focus();
    win.print();
    const cleanup = () => frame.remove();
    // Chrome 的 print() 不阻塞，用 afterprint 收尾；没有该事件时兜底定时
    win.addEventListener("afterprint", cleanup, { once: true });
    setTimeout(cleanup, 60000);
  };

  if (doc.readyState === "complete") run();
  else frame.onload = run;
}
