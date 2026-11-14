import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { Button } from "./ui";

/**
 * 导出菜单：三种格式收进一个按钮。
 *
 * 写作页的操作条只有约 400px，三个导出按钮并排会把「存入知识库」挤到第二行。
 *
 * 面板方向是算出来的，不写死：主内容区 `.page-content` 带 `overflow-x: clip`，
 * 按 CSS 规范另一轴的 visible 会被算成裁剪，而操作条就在页面底部，
 * 向下展开会立刻出界被切掉。下方空间不够时向上翻，面板始终落在容器内。
 */
export function ExportMenu({
  disabled,
  onTxt,
  onDocx,
  onPdf,
}: {
  disabled?: boolean;
  onTxt: () => void;
  onDocx: () => void;
  onPdf: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"down" | "up">("down");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".export-wrap")) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const MENU_HEIGHT = 128;

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // 视口下方放不下面板就往上翻
    setPlacement(window.innerHeight - rect.bottom < MENU_HEIGHT + 12 ? "up" : "down");
    setOpen(true);
  }

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="export-wrap" ref={rootRef}>
      <Button
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Download size={15} />
        导出
        <ChevronDown size={13} className="export-caret" />
      </Button>

      {open && (
        <div className={placement === "up" ? "export-menu is-up" : "export-menu"} role="menu">
          <button type="button" role="menuitem" className="export-item" onClick={() => choose(onTxt)}>
            纯文本
            <small>.txt</small>
          </button>
          <button type="button" role="menuitem" className="export-item" onClick={() => choose(onDocx)}>
            Word 文档
            <small>.docx</small>
          </button>
          <button type="button" role="menuitem" className="export-item" onClick={() => choose(onPdf)}>
            PDF
            <small>打印后另存</small>
          </button>
        </div>
      )}
    </div>
  );
}
