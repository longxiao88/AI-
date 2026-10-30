import { useCanvasEffect } from "../../lib/useCanvasEffect";
import { initFishEffect } from "./fishEffect";

/**
 * 全屏鱼群背景特效：鱼群跟随鼠标，带透明渐变、半透明鱼身与发光尾坠。
 * 位于背景光晕之上、气泡与页面内容之下。
 * 自动跟随 <html> 上的 data-theme（深浅色）与 data-motion（动效开关）。
 */
export function FishBackground() {
  const canvasRef = useCanvasEffect(initFishEffect);

  return <canvas ref={canvasRef} className="fish-bg" aria-hidden="true" />;
}
