import { useEffect, useRef } from "react";
import { THEME_REVEAL_BEGIN, THEME_REVEAL_END } from "../../lib/themeTransition";
import { initBubbleEffect } from "./bubbleEffect";

/**
 * 全屏气泡背景特效：位于背景光晕之上、文字与卡片之下。
 * 自动跟随 <html> 上的 data-theme（深浅色）与 data-motion（动效开关）。
 *
 * surface 决定「这一页的底板是什么颜色」：
 * - "auto"（默认）：跟随主题，昼夜都铺气泡，调色板随主题切换。
 * - "dark"：底板永远是深色场景（登录/注册页的 .is-cinematic 深海视频），
 *   和主题无关，所以固定用深色调色板。
 */
export function BubbleBackground({ surface = "auto" }: { surface?: "auto" | "dark" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const root = document.documentElement;
    const read = () => {
      const theme = root.dataset.theme;
      const motionOff = root.dataset.motion === "off";
      return {
        // 登录页底板是固定的深色场景，主题是 light 时也不能用浅色气泡
        theme: surface === "dark" ? "dark" : theme,
        // 昼夜都铺：调色板由 theme 决定（浅色主题用浅色气泡），
        // 只有用户自己关掉「动效」才暂停。
        paused: motionOff,
      };
    };

    const initial = read();
    const effect = initBubbleEffect(canvas, {
      theme: initial.theme,
      paused: initial.paused,
    });

    // 主题 / 动效开关都写在 <html> 的 data-* 上，这里同步给画布
    const observer = new MutationObserver(() => {
      const next = read();
      effect.setTheme(next.theme);
      effect.setPaused(next.paused);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-motion"] });

    // 主题揭幕：开始前清空画布，分界线扫到哪里、哪里的气泡就消失
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
  }, [surface]);

  return (
    <canvas ref={canvasRef} className="bubble-bg" aria-hidden="true" />
  );
}
