import { useEffect, useRef } from "react";
import { initBubbleEffect } from "./bubbleEffect";

type BubbleBackgroundProps = {
  /** 点击气泡是否爆炸，默认开启 */
  interactive?: boolean;
};

/**
 * 全屏气泡背景特效：位于背景光晕之上、文字与卡片之下。
 * 自动跟随 <html> 上的 data-theme（深浅色）与 data-motion（动效开关）。
 */
export function BubbleBackground({ interactive = true }: BubbleBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const root = document.documentElement;
    const read = () => ({
      theme: root.dataset.theme,
      motionOff: root.dataset.motion === "off",
    });

    const initial = read();
    const effect = initBubbleEffect(canvas, {
      theme: initial.theme,
      paused: initial.motionOff,
      interactive,
    });

    // 主题 / 动效开关都写在 <html> 的 data-* 上，这里同步给画布
    const observer = new MutationObserver(() => {
      const next = read();
      effect.setTheme(next.theme);
      effect.setPaused(next.motionOff);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-motion"] });

    return () => {
      observer.disconnect();
      effect.destroy();
    };
  }, [interactive]);

  return <canvas ref={canvasRef} className="bubble-bg" aria-hidden="true" />;
}
