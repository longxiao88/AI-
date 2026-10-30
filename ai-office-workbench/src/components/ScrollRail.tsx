import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "./ui";

type RailState = {
  /** 页面能否滚动；不能滚时整条轨隐藏 */
  visible: boolean;
  /** 滑块高度（px） */
  thumb: number;
  /** 滑块相对轨道顶部的偏移（px） */
  top: number;
  /** 可滚动距离（px） */
  range: number;
};

const STEP = 240; // 点一次三角滚动的距离

/**
 * 右侧自绘滚动指示。
 *
 * 原生滚动条的滑道没法去掉（会切出一条灰带子挡住背景图），
 * 三角按钮也无法可靠地自定义外观，所以这里把原生滚动条整个藏掉，
 * 只用一条 4px 的细滑块 + 上下两个小三角来表示位置：
 *   - 不画滑道，背景图完整露出来；
 *   - 滑块可以拖动，三角可以点；
 *   - 页面不能滚动时整条轨道淡出，不占视觉。
 */
export function ScrollRail() {
  const [state, setState] = useState<RailState>({ visible: false, thumb: 0, top: 0, range: 0 });
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startScroll: number; perPx: number } | null>(null);

  const measure = useCallback(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    const trackH = trackRef.current?.clientHeight ?? 0;
    const viewH = window.innerHeight;
    const max = doc.scrollHeight - viewH;

    if (trackH <= 0 || max <= 4) {
      setState((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      return;
    }

    const thumb = Math.min(trackH, Math.max(34, Math.round((viewH / doc.scrollHeight) * trackH)));
    const top = Math.round(((trackH - thumb) * doc.scrollTop) / max);
    setState({ visible: true, thumb, top, range: max });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);

    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [measure]);

  const scrollBy = (delta: number) => {
    window.scrollBy({ top: delta, behavior: "smooth" });
  };

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const trackH = trackRef.current?.clientHeight ?? 0;
    const span = trackH - state.thumb;
    if (span <= 0) return;
    drag.current = {
      startY: event.clientY,
      startScroll: (document.scrollingElement ?? document.documentElement).scrollTop,
      perPx: state.range / span,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const doc = document.scrollingElement ?? document.documentElement;
    doc.scrollTop = drag.current.startScroll + (event.clientY - drag.current.startY) * drag.current.perPx;
  }

  function handlePointerUp() {
    drag.current = null;
  }

  return (
    <div className={cn("scroll-rail", state.visible && "is-on")} aria-hidden="true">
      <button type="button" className="rail-arrow" tabIndex={-1} onClick={() => scrollBy(-STEP)}>
        <ChevronUp size={12} strokeWidth={2.4} />
      </button>
      <div className="rail-track" ref={trackRef}>
        <div
          className="rail-thumb"
          style={{ height: state.thumb, transform: `translate(-50%, ${state.top}px)` }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
      <button type="button" className="rail-arrow" tabIndex={-1} onClick={() => scrollBy(STEP)}>
        <ChevronDown size={12} strokeWidth={2.4} />
      </button>
    </div>
  );
}
