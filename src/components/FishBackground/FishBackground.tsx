import { useEffect, useRef } from "react";
import { THEME_REVEAL_BEGIN, THEME_REVEAL_END } from "../../lib/themeTransition";
import { initFishEffect } from "./fishEffect";

/**
 * 全屏鱼群背景特效：鱼群跟随鼠标，带透明渐变、半透明鱼身与发光尾坠。
 * 位于背景光晕之上、气泡与页面内容之下。
 * 自动跟随 <html> 上的 data-theme（深浅色）与 data-motion（动效开关）。
 */
export function FishBackground() {
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
    // 白天模式铺海浪视频，鱼群会和海浪叠在一起显得杂乱，
    // 所以白天直接不生成、不绘制；只在夜间出现。
    const effect = initFishEffect(canvas, {
      theme: initial.theme,
      paused: initial.motionOff || initial.theme === "light",
    });

    // 主题 / 动效开关都写在 <html> 的 data-* 上，这里同步给画布
    const observer = new MutationObserver(() => {
      const next = read();
      effect.setTheme(next.theme);
      effect.setPaused(next.motionOff || next.theme === "light");
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-motion"] });

    // 主题揭幕：分界线扫到哪里、哪里的鱼就消失
    const onRevealBegin = () => effect.setSweep(true);
    const onRevealEnd = () => effect.setSweep(false);
    window.addEventListener(THEME_REVEAL_BEGIN, onRevealBegin);
    window.addEventListener(THEME_REVEAL_END, onRevealEnd);

    return () => {
      observer.disconnect();
      window.removeEventListener(THEME_REVEAL_BEGIN, onRevealBegin);
      window.removeEventListener(THEME_REVEAL_END, onRevealEnd);
      effect.destroy();
    };
  }, []);

  return <canvas ref={canvasRef} className="fish-bg" aria-hidden="true" />;
}
