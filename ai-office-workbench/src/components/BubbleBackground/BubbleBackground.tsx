import { useCanvasEffect } from "../../lib/useCanvasEffect";
import { initBubbleEffect } from "./bubbleEffect";

/**
 * 全屏气泡背景特效：位于背景光晕之上、文字与卡片之下。
 * 可点击点破，破裂后分裂子泡并溅出水雾。
 * 自动跟随 <html> 上的 data-theme（深浅色）与 data-motion（动效开关）。
 */
export function BubbleBackground() {
  const canvasRef = useCanvasEffect(initBubbleEffect);

  return <canvas ref={canvasRef} className="bubble-bg" aria-hidden="true" />;
}
