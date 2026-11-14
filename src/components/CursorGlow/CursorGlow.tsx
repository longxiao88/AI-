import { useEffect, useRef } from "react";
import { initCursorGlow } from "./cursorGlowEffect";

/**
 * 光标发光拖尾特效：鼠标移动时喷出蓝色发光粒子，形成离散、渐隐的拖尾，
 * 光标下方带一圈极淡恒亮光晕。单独一层 canvas，叠在页面内容之上（最上层），
 * 但 pointer-events 为 none，不影响交互。自动跟随主题与动效开关。
 */
export function CursorGlow() {
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
    const effect = initCursorGlow(canvas, {
      theme: initial.theme,
      paused: initial.motionOff,
    });

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
  }, []);

  return <canvas ref={canvasRef} className="cursor-glow" aria-hidden="true" />;
}
