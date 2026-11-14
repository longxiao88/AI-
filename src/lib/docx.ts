/**
 * 把纯文本导出成 .docx（Office Open XML）。
 *
 * 不引 `docx` 这类库：docx 本质就是一个 zip 加几个固定 XML，
 * 项目里已经有 jszip，现拼出来更轻，而且能顺手按 Markdown 的
 * 标题/列表/引用分出层级——写作结果本来就是那种结构。
 */

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function esc(text: string) {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

export type Block =
  | { kind: "h1" | "h2" | "h3"; text: string }
  | { kind: "li"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "p"; text: string }
  | { kind: "blank" };

/** 只认写作场景里会出现的几种 Markdown 标记，不做完整解析 */
export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let inCode = false;

  for (const raw of source.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      blocks.push({ kind: "code", text: line });
      continue;
    }
    if (!line.trim()) {
      blocks.push({ kind: "blank" });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3;
      blocks.push({ kind: (`h${level}` as "h1" | "h2" | "h3"), text: heading[2].trim() });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push({ kind: "li", text: bullet[1].trim() });
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      blocks.push({ kind: "quote", text: quote[1].trim() });
      continue;
    }
    blocks.push({ kind: "p", text: line.trim() });
  }
  return blocks;
}

const FONT_BODY = `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/>`;
const FONT_HEAD = `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="黑体"/>`;
const FONT_CODE = `<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="宋体"/>`;

function run(text: string, props: string) {
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** 用样式而不是直接加粗：Word 的导航窗格和自动目录只认 Heading 样式 */
function heading(text: string, level: 1 | 2 | 3) {
  return `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function paragraph(content: string, pPr = "") {
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${content}</w:p>`;
}

function blockToXml(block: Block): string {
  switch (block.kind) {
    case "blank":
      return "<w:p/>";
    case "h1":
      return heading(block.text, 1);
    case "h2":
      return heading(block.text, 2);
    case "h3":
      return heading(block.text, 3);
    case "li":
      return paragraph(run(`· ${block.text}`, `${FONT_BODY}<w:sz w:val="24"/>`), '<w:ind w:left="360" w:hanging="240"/><w:spacing w:after="60"/>');
    case "quote":
      return paragraph(run(block.text, `${FONT_BODY}<w:sz w:val="24"/><w:i/><w:color w:val="595959"/>`), '<w:ind w:left="360"/><w:spacing w:after="120"/>');
    case "code":
      return paragraph(run(block.text, `${FONT_CODE}<w:sz w:val="20"/>`), '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:after="0"/>');
    default:
      return paragraph(run(block.text, `${FONT_BODY}<w:sz w:val="24"/>`), '<w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="480"/>');
  }
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const headingStyle = (level: 1 | 2 | 3, size: number, before: number, after: number) =>
  `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr>${FONT_HEAD}<w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;

/** 一级 18pt、二级 15pt、三级 14pt，与写作页的层级感对齐 */
const headingStyles =
  headingStyle(1, 36, 320, 160) + headingStyle(2, 30, 240, 120) + headingStyle(3, 28, 200, 100);

/** 定义 Normal 的默认字体与语言，避免 Word 把中文回退成别的字体 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>${FONT_BODY}<w:sz w:val="24"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${headingStyles}</w:styles>`;

/** 文件名去掉 Windows 不允许的字符 */
export function safeFileName(title: string, fallback = "写作结果") {
  return (title || fallback).replace(/[\\/:*?"<>|]/g, "_").trim() || fallback;
}

/**
 * 生成并下载 .docx。jszip 动态加载，不占首屏包体。
 */
export async function exportDocx(text: string, title: string) {
  const { default: JSZip } = await import("jszip");

  const body = parseBlocks(text).map(blockToXml).join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.folder("_rels")!.file(".rels", ROOT_RELS);
  const word = zip.folder("word")!;
  word.file("document.xml", documentXml);
  word.file("styles.xml", STYLES);
  word.folder("_rels")!.file("document.xml.rels", DOC_RELS);

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: DOCX_MIME,
    compression: "DEFLATE",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(title)}.docx`;
  // 必须挂进文档再点：游离的 <a> 第一次能触发下载，之后会被浏览器忽略
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
